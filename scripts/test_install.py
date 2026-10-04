"""Focused installer regressions: selected contracts, legacy output, no unsafe writes."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[1]
AGENTS = ("codex", "cursor", "aider", "continue", "windsurf", "claude-code")
FILES = {"codex": "AGENTS.md", "aider": "CONVENTIONS.md", "continue": ".continuerules", "windsurf": ".windsurfrules"}


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="instrumentation install ")
        self.root = Path(self.temp.name)
        self.home = self.root / "home"
        self.home.mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def run_install(self, project, agent="codex", skill=None, extra=(), expected=0):
        args = ["bash", str(REPO / "scripts/install.sh"), f"--agent={agent}", f"--project={project}"]
        if skill is not None:
            args.append(f"--skill={skill}")
        result = subprocess.run(args + list(extra), env={**os.environ, "HOME": str(self.home)}, text=True, capture_output=True)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result

    def artifact(self, project, agent, skill):
        if agent == "claude-code":
            return project / ".claude/skills" / skill
        if agent == "cursor":
            return project / ".cursor/rules" / f"{skill}.mdc"
        return project / FILES[agent]

    def test_each_profile_and_agent_is_idempotent_and_points_to_only_its_contract(self):
        for skill in ("cloudwatch-instrumentation", "lambda-powertools"):
            for agent in AGENTS:
                with self.subTest(skill=skill, agent=agent):
                    project = self.root / skill / agent
                    self.run_install(project, agent, skill)
                    path = self.artifact(project, agent, skill)
                    before = path.read_text() if agent != "claude-code" else str(path.resolve())
                    self.run_install(project, agent, skill)
                    after = path.read_text() if agent != "claude-code" else str(path.resolve())
                    self.assertEqual(before, after)
                    if agent == "claude-code":
                        expected = REPO / "skills/lambda-powertools" if skill == "lambda-powertools" else REPO
                        self.assertEqual(path.resolve(), expected)
                    elif skill == "lambda-powertools":
                        self.assertIn(str(REPO / "skills/lambda-powertools/SKILL.md"), before)
                        self.assertNotIn("Use OpenTelemetry for traces", before)
                        self.assertNotIn("MINIMAL_CONCAT", before)
                        self.assertIn("required surface coverage", before)
                        self.assertIn("existing equivalence", before)
                        self.assertIn("No silent coverage gaps", before)
                        self.assertIn("any language", before)
                        self.assertIn("language-adaptation.md", before)
                        if agent == "cursor":
                            self.assertIn('globs: "**/*"', before)
                        self.assertEqual(before.count("<!-- BEGIN lambda-powertools -->"), 1)
                        self.assertLess(len(before), 1500)

    def test_omitted_skill_preserves_default_paths_and_codex_contract(self):
        project = self.root / "default"
        self.run_install(project)
        self.assertIn(f"Read `{REPO}/SKILL.md`", (project / "AGENTS.md").read_text())
        self.assertNotIn("<!-- BEGIN lambda-powertools -->", (project / "AGENTS.md").read_text())

    def test_existing_project_instructions_survive_powertools_updates(self):
        for agent in FILES:
            project = self.root / agent
            project.mkdir()
            path = project / FILES[agent]
            path.write_text("# Local conventions\nKeep this.\n")
            self.run_install(project, agent, "lambda-powertools")
            self.run_install(project, agent, "lambda-powertools")
            self.assertTrue(path.read_text().startswith("# Local conventions\nKeep this.\n"))
            self.assertEqual(path.read_text().count("<!-- BEGIN lambda-powertools -->"), 1)

    def test_conflicting_profiles_across_agents_refuse_before_writing(self):
        for source_agent in AGENTS:
            for old, new in (("cloudwatch-instrumentation", "lambda-powertools"), ("lambda-powertools", "cloudwatch-instrumentation")):
                project = self.root / source_agent / old
                self.run_install(project, source_agent, old)
                path = self.artifact(project, source_agent, old)
                before = path.read_text() if source_agent != "claude-code" else str(path.resolve())
                result = self.run_install(project, "codex", new, expected=1)
                self.assertIn("conflicting", result.stderr)
                after = path.read_text() if source_agent != "claude-code" else str(path.resolve())
                self.assertEqual(before, after)
                if source_agent != "codex":
                    self.assertFalse((project / "AGENTS.md").exists())

    def test_inherited_parent_profile_is_detected_for_nested_and_symlink_projects(self):
        parent = self.root / "monorepo"
        self.run_install(parent, skill="cloudwatch-instrumentation")
        nested = parent / "lambda"
        self.run_install(nested, skill="lambda-powertools", expected=1)
        self.assertFalse(nested.exists())
        nested.mkdir()
        alias = self.root / "alias"
        alias.symlink_to(nested, target_is_directory=True)
        self.run_install(alias, skill="lambda-powertools", expected=1)
        self.assertFalse((nested / "AGENTS.md").exists())

    def test_conflicting_global_claude_skill_is_detected(self):
        global_skill = self.home / ".claude/skills/cloudwatch-instrumentation"
        global_skill.parent.mkdir(parents=True)
        global_skill.symlink_to(REPO, target_is_directory=True)
        project = self.root / "global-conflict"
        self.run_install(project, skill="lambda-powertools", expected=1)
        self.assertFalse(project.exists())

    def test_malformed_or_duplicate_markers_do_not_truncate_local_rules(self):
        cases = (
            "<!-- BEGIN lambda-powertools -->\nKeep this.",
            "<!-- END lambda-powertools -->\n<!-- BEGIN lambda-powertools -->\nKeep this.",
            "<!-- BEGIN lambda-powertools -->\n<!-- END lambda-powertools -->\n" * 2,
        )
        for i, text in enumerate(cases):
            project = self.root / f"malformed-{i}"
            project.mkdir()
            path = project / "AGENTS.md"
            path.write_text(text)
            self.run_install(project, skill="lambda-powertools", expected=1)
            self.assertEqual(path.read_text(), text)

    def test_invalid_or_repeated_selection_has_no_side_effects(self):
        for skill, extra in (("unknown", ()), ("lambda-powertools", ("--skill=cloudwatch-instrumentation",))):
            project = self.root / skill
            self.run_install(project, skill=skill, extra=extra, expected=2)
            self.assertFalse(project.exists())
        self.run_install(self.root / "invalid-agent", agent="invalid", expected=2)
        self.assertFalse((self.root / "invalid-agent").exists())

    def test_relative_clone_path_and_real_directory_safety(self):
        project = self.root / "relative"
        relative = os.path.relpath(REPO, Path.cwd())
        self.run_install(project, "claude-code", "lambda-powertools", (f"--skill-clone={relative}",))
        self.assertEqual((project / ".claude/skills/lambda-powertools").resolve(), REPO / "skills/lambda-powertools")
        other_project = self.root / "real-directory"
        target = other_project / ".claude/skills/lambda-powertools"
        target.mkdir(parents=True)
        (target / "local").write_text("Keep")
        self.run_install(other_project, "claude-code", "lambda-powertools", expected=1)
        self.assertEqual((target / "local").read_text(), "Keep")


if __name__ == "__main__":
    unittest.main()

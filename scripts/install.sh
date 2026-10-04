#!/usr/bin/env bash
# AWS instrumentation installer - select one contract per project.
#
# Usage:
#   scripts/install.sh [--skill=<name>] --agent=<name> [--project=<path>] [--skill-clone=<path>]
#
# Agents: claude-code, cursor, codex, aider, continue, windsurf
# (Claude.ai web is not scriptable — see adapters/claude-ai-web.md.)
#
# Idempotent: re-run safely after the skill updates.

set -euo pipefail

SKILL="cloudwatch-instrumentation"
SKILL_EXPLICIT=0
AGENT=""
PROJECT=""
PROJECT_EXPLICIT=0
SKILL_CLONE=""

usage() {
    cat <<'EOF'
AWS instrumentation skill installer

Usage:
  scripts/install.sh [--skill=<name>] --agent=<name> [--project=<path>] [--skill-clone=<path>]

Agents:
  claude-code   symlink into ~/.claude/skills/ (or <project>/.claude/skills/)
  cursor        write <project>/.cursor/rules/<selected-skill>.mdc
  codex         insert skill-enable block into <project>/AGENTS.md
  aider         write <project>/CONVENTIONS.md
  continue      write <project>/.continuerules
  windsurf      write <project>/.windsurfrules

Skills:
  cloudwatch-instrumentation  existing OTel contract (default)
  lambda-powertools          Lambda/TypeScript Logger, EMF Metrics, explicit tracing selection

Options:
  --skill=<name>         select exactly one contract; no combined profile
  --agent=<name>         required
  --project=<path>       target project dir (default: $PWD; ignored for
                         user-level claude-code)
  --skill-clone=<path>   path to the cloned skill repo (default: this
                         script's repo root)
  --help                 show this help

Claude.ai web is not scriptable — upload via Settings -> Skills.
EOF
}

for arg in "$@"; do
    case "$arg" in
        --skill=*)
            if [[ "$SKILL_EXPLICIT" -eq 1 ]]; then
                echo "error: select --skill exactly once" >&2; exit 2
            fi
            SKILL="${arg#*=}"; SKILL_EXPLICIT=1 ;;

        --agent=*)       AGENT="${arg#*=}" ;;
        --project=*)     PROJECT="${arg#*=}"; PROJECT_EXPLICIT=1 ;;
        --skill-clone=*) SKILL_CLONE="${arg#*=}" ;;
        --help|-h)       usage; exit 0 ;;
        *) echo "error: unknown argument: $arg" >&2; usage >&2; exit 2 ;;
    esac
done

if [[ -z "$AGENT" ]]; then
    echo "error: --agent=<name> is required" >&2
    usage >&2
    exit 2
fi

case "$SKILL" in
    cloudwatch-instrumentation|lambda-powertools) ;;
    *) echo "error: unknown skill '$SKILL'" >&2; exit 2 ;;
esac
case "$AGENT" in
    claude-code|cursor|codex|aider|continue|windsurf) ;;
    *) echo "error: unknown agent '$AGENT'" >&2; exit 2 ;;
esac

if [[ -z "$PROJECT" ]]; then
    PROJECT="${PWD}"
fi

# Resolve skill-clone to the repo root containing this script.
if [[ -z "$SKILL_CLONE" ]]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    SKILL_CLONE="$(cd "$SCRIPT_DIR/.." && pwd)"
fi

if [[ ! -f "$SKILL_CLONE/SKILL.md" ]]; then
    echo "error: skill-clone at '$SKILL_CLONE' does not look like the skill repo (no SKILL.md)" >&2
    exit 1
fi

# Resolve explicit relative clone paths before writing symlinks/instructions.
SKILL_CLONE="$(cd "$SKILL_CLONE" && pwd)"
SKILL_ROOT="$SKILL_CLONE"
OTHER_SKILL="lambda-powertools"
if [[ "$SKILL" == "lambda-powertools" ]]; then
    SKILL_ROOT="$SKILL_CLONE/skills/lambda-powertools"
    OTHER_SKILL="cloudwatch-instrumentation"
fi
if [[ ! -f "$SKILL_ROOT/SKILL.md" ]]; then
    echo "error: selected skill is missing: $SKILL_ROOT/SKILL.md" >&2
    exit 1
fi

# Check every supported project discovery surface before any write, even when
# changing agents. Old concatenated adapters identify their skill in frontmatter.
reject_conflicts() {
    local candidate scope
    scope="$PROJECT"
    if [[ "$scope" != /* ]]; then scope="$PWD/$scope"; fi
    if [[ -d "$scope" ]]; then scope="$(cd "$scope" && pwd -P)"; fi
    # Ancestor instructions can apply to a child project. A nested install must
    # not bypass an active parent profile merely by choosing another directory.
    while :; do
        for candidate in "$scope/AGENTS.md" "$scope/CONVENTIONS.md" \
            "$scope/.continuerules" "$scope/.windsurfrules" \
            "$scope/.cursor/rules/$OTHER_SKILL.mdc"; do
            if [[ -f "$candidate" ]] && { grep -qF "<!-- BEGIN $OTHER_SKILL -->" "$candidate" ||
                grep -qxF "name: $OTHER_SKILL" "$candidate" ||
                [[ "$candidate" == "$scope/.cursor/rules/$OTHER_SKILL.mdc" ]]; }; then
                echo "error: conflicting $OTHER_SKILL installation at $candidate; remove or explicitly scope the old instructions before selecting $SKILL" >&2
                exit 1
            fi
        done
        candidate="$scope/.claude/skills/$OTHER_SKILL"
        if [[ -e "$candidate" || -L "$candidate" ]]; then
            echo "error: conflicting $OTHER_SKILL skill at $candidate; remove or explicitly scope it before selecting $SKILL" >&2
            exit 1
        fi
        [[ "$scope" == "/" ]] && break
        scope="$(dirname "$scope")"
    done
    candidate="$HOME/.claude/skills/$OTHER_SKILL"
    if [[ -e "$candidate" || -L "$candidate" ]]; then
        echo "error: conflicting $OTHER_SKILL skill at $candidate; remove or explicitly scope it before selecting $SKILL" >&2
        exit 1
    fi
}
reject_conflicts

skill_enable_block() {
    if [[ "$SKILL" == "lambda-powertools" ]]; then
        cat <<EOF
<!-- BEGIN lambda-powertools -->
## Lambda Powertools instrumentation

For AWS Lambda TypeScript/Node.js telemetry, use only the \`lambda-powertools\`
contract in this scope. Start with an operational question; independently
select a metric, diagnostic log, trace, or no new signal. Do not load the root
CloudWatch/OTel skill for this workload.

1. Read \`$SKILL_ROOT/SKILL.md\`.
2. Load only the relevant references linked there under \`$SKILL_ROOT/references/\`.
3. Adapt the selected example from \`$SKILL_ROOT/examples/typescript/src/\`.
4. Apply the review rubric and enforcement guidance before completing the change.

Use Powertools directly. Metrics use EMF; Tracer uses X-Ray. Evaluate all signals
together. Explicitly enable or disable tracing with a reason; enable when
dependency timing or distributed causality is required. No silent omission.
Do not dump payloads/errors or add all three signals mechanically.
<!-- END lambda-powertools -->
EOF
        return
    fi
    cat <<EOF
<!-- BEGIN cloudwatch-instrumentation -->
## CloudWatch OpenTelemetry instrumentation

This project uses the \`cloudwatch-instrumentation\` skill. When writing code
that emits an OpenTelemetry metric or trace, writes an application log for
CloudWatch, measures duration, counts failures, investigates production
telemetry, or changes an AWS telemetry deployment:

1. Read \`$SKILL_ROOT/SKILL.md\`.
2. Follow its decision rules and surface patterns.
3. For deeper rules (tagging, cost, lifecycle, deployment, and logging), open
   the relevant file under \`$SKILL_ROOT/references/\`.
4. Use \`$SKILL_ROOT/examples/typescript/\` for Node.js or TypeScript and
   \`$SKILL_ROOT/examples/python/\` for Python.

Keep AWS authentication in the collector or runtime configuration. Never
attach unbounded identifiers or exception text to metric attributes. Use only
governed structured logs; never log credentials, session values, bodies,
prompts, or raw errors.
<!-- END cloudwatch-instrumentation -->
EOF
}

MINIMAL_CONCAT_FILES=(
    "$SKILL_CLONE/SKILL.md"
    "$SKILL_CLONE/references/charter.md"
    "$SKILL_CLONE/references/cloudwatch-otlp.md"
    "$SKILL_CLONE/references/deployment-targets.md"
    "$SKILL_CLONE/references/structured-logging.md"
    "$SKILL_CLONE/references/investigation-playbooks.md"
    "$SKILL_CLONE/references/signal-model.md"
    "$SKILL_CLONE/references/tagging-and-cardinality.md"
    "$SKILL_CLONE/references/surface-patterns.md"
    "$SKILL_CLONE/references/failure-taxonomy.md"
    "$SKILL_CLONE/references/ai-agent-conversations.md"
    "$SKILL_CLONE/references/review-rubric.md"
)

concat_minimal() {
    local out="$1"
    local header="$2"
    mkdir -p "$(dirname "$out")"
    {
        if [[ -n "$header" ]]; then
            printf '%s\n' "$header"
        fi
        cat "${MINIMAL_CONCAT_FILES[@]}"
    } > "$out"
}

install_claude_code() {
    local target
    if [[ "$PROJECT_EXPLICIT" -eq 1 ]]; then
        target="${PROJECT}/.claude/skills/$SKILL"
    else
        target="${HOME}/.claude/skills/$SKILL"
    fi
    mkdir -p "$(dirname "$target")"
    if [[ -L "$target" ]]; then
        local current
        current="$(readlink "$target")"
        if [[ "$current" == "$SKILL_ROOT" ]]; then
            echo "Done: symlink already points at $SKILL_ROOT ($target)"
            return 0
        fi
        rm "$target"
    elif [[ -e "$target" ]]; then
        echo "error: $target exists and is not a symlink; refusing to overwrite" >&2
        exit 1
    fi
    ln -s "$SKILL_ROOT" "$target"
    echo "Done: wrote symlink $target -> $SKILL_ROOT"
}

install_concat() {
    # $1 = output path relative to $PROJECT
    # $2 = optional frontmatter header
    local out="${PROJECT}/$1"
    concat_minimal "$out" "$2"
    echo "Done: wrote $out"
}

install_cursor() {
    local header
    if [[ "$SKILL" == "lambda-powertools" ]]; then
        header='---
description: Minimum useful AWS Lambda Powertools telemetry
globs: "**/*.{ts,js,mjs,cjs}"
alwaysApply: true
---
'
        install_managed ".cursor/rules/$SKILL.mdc" "$header"
    else
        header='---
description: Governed OpenTelemetry for CloudWatch - see cloudwatch-instrumentation skill
globs: "**/*.{ts,tsx,js,mjs,cjs,py}"
alwaysApply: true
---
'
        install_concat ".cursor/rules/$SKILL.mdc" "$header"
    fi
}

install_aider() {
    if [[ "$SKILL" == "lambda-powertools" ]]; then
        install_managed "CONVENTIONS.md" ""
    else
        install_concat "CONVENTIONS.md" ""
    fi
}

install_continue() {
    if [[ "$SKILL" == "lambda-powertools" ]]; then
        install_managed ".continuerules" ""
    else
        install_concat ".continuerules" ""
    fi
}

install_windsurf() {
    if [[ "$SKILL" == "lambda-powertools" ]]; then
        install_managed ".windsurfrules" ""
    else
        install_concat ".windsurfrules" ""
    fi
}

install_managed() {
    local out="${PROJECT}/$1"
    local header="${2:-}"
    local begin="<!-- BEGIN $SKILL -->"
    local end="<!-- END $SKILL -->"
    local block
    block="$(skill_enable_block)"

    mkdir -p "$(dirname "$out")"
    if [[ -f "$out" ]]; then
        local begins ends
        begins="$(grep -cxF "$begin" "$out" || true)"
        ends="$(grep -cxF "$end" "$out" || true)"
        if [[ "$begins" != "$ends" || "$begins" -gt 1 ]] ||
            ! awk -v begin="$begin" -v end="$end" '
                $0 == begin { open=1 }
                $0 == end { if (!open) exit 1; open=0 }
                END { if (open) exit 1 }
            ' "$out"; then
            echo "error: malformed $SKILL markers in $out; refusing to modify" >&2
            exit 1
        fi
    fi
    if [[ -f "$out" ]] && grep -qxF "$begin" "$out"; then
        # Replace the existing block in place.
        local tmp block_file
        tmp="$(mktemp)"
        block_file="$(mktemp)"
        printf '%s\n' "$block" > "$block_file"
        awk -v begin="$begin" -v end="$end" -v block_file="$block_file" '
            BEGIN {
                while ((getline line < block_file) > 0) {
                    block = (block == "" ? line : block "\n" line)
                }
                close(block_file)
            }
            $0 == begin { skip = 1; print block; next }
            skip && $0 == end { skip = 0; next }
            !skip { print }
        ' "$out" > "$tmp"
        mv "$tmp" "$out"
        rm -f "$block_file"
        echo "Done: updated skill-enable block in $out"
    else
        if [[ -f "$out" ]]; then
            printf '\n%s\n' "$block" >> "$out"
        else
            printf '%s\n\n%s\n' "$header" "$block" > "$out"
        fi
        echo "Done: appended skill-enable block to $out"
    fi
}

install_codex() {
    install_managed "AGENTS.md" "# Agents guide"
}

case "$AGENT" in
    claude-code) install_claude_code ;;
    cursor)      install_cursor ;;
    codex)       install_codex ;;
    aider)       install_aider ;;
    continue)    install_continue ;;
    windsurf)    install_windsurf ;;
    *)
        echo "error: unknown agent '$AGENT'" >&2
        echo "       valid: claude-code, cursor, codex, aider, continue, windsurf" >&2
        exit 2
        ;;
esac

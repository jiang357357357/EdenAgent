"""Offline TOML role export for review. Requires Python 3.11; never starts a host."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import tomllib


ALIASES = {
    'read': 'eden_read_file', 'write': 'eden_write_file', 'bash': 'eden_exec',
    'load_skill': 'read_skill', 'list_skills': 'list_skills',
    **{name: name for name in (
        'search_memories', 'remember_memory', 'update_memory', 'forget_memory',
        'switch_workspace', 'switch_session_assistant', 'switch_character_action',
        'list_character_stickers', 'remember_character_sticker', 'send_character_sticker',
        'delete_character_sticker', 'list_memos', 'list_due_memos', 'get_next_memo_wake',
        'list_connectors', 'query_connector', 'spawn_agent', 'send_message',
        'followup_task', 'list_agents', 'interrupt_agent', 'wait_agent',
    )},
}
READ_ONLY_MAPPED = [ALIASES[name] for name in (
    'read', 'load_skill', 'list_skills', 'search_memories', 'list_memos',
    'list_due_memos', 'get_next_memo_wake', 'list_connectors', 'query_connector',
    'spawn_agent', 'send_message', 'followup_task', 'list_agents', 'interrupt_agent', 'wait_agent',
)]


def candidate(raw):
    known = {'name', 'description', 'developer_instructions', 'skills', 'model', 'reasoning',
             'sandbox_mode', 'allowed_tools', 'denied_tools', 'budget', 'source'}
    issues = ['Unsupported field: ' + key for key in raw.keys() - known]
    budget = raw.get('budget', {})
    if not isinstance(budget, dict):
        raise ValueError('budget must be a table')
    issues += ['Unsupported budget field: ' + key for key in budget.keys() - {
        'max_turns', 'max_tool_calls', 'timeout_seconds', 'max_tokens', 'max_cost_microusd'}]
    mapped = {}
    for field, fallback in [('allowed_tools', None), ('denied_tools', [])]:
        values = raw.get(field, fallback)
        if values is not None and (not isinstance(values, list) or any(not isinstance(item, str) for item in values)):
            raise ValueError(field + ' must be an array of tool names')
        if values is None and field == 'denied_tools':
            raise ValueError('denied_tools cannot be null')
        unknown = [] if values is None else [name for name in values if name not in ALIASES]
        issues += ['Tool requires manual mapping: ' + name for name in unknown]
        mapped[field] = None if values is None else sorted({ALIASES[name] for name in values if name in ALIASES})
    mode = raw.get('sandbox_mode', 'inherit')
    if mode == 'read-only':
        allowed = mapped['allowed_tools']
        mapped['allowed_tools'] = sorted(set(READ_ONLY_MAPPED if allowed is None else allowed).intersection(READ_ONLY_MAPPED))
    seconds = budget.get('timeout_seconds', 1800)
    if not isinstance(seconds, int) or isinstance(seconds, bool):
        raise ValueError('timeout_seconds must be an integer')
    definition = {
        'name': raw.get('name', ''), 'description': raw.get('description', ''),
        'instructions': raw.get('developer_instructions', ''), 'skills': raw.get('skills', []),
        'model': raw.get('model'), 'reasoning': raw.get('reasoning'), 'sandboxMode': mode,
        'allowedTools': mapped['allowed_tools'], 'deniedTools': mapped['denied_tools'],
        'maxTurns': budget.get('max_turns', 64), 'maxToolCalls': budget.get('max_tool_calls', 128),
        'maxModelRequests': 128, 'maxTokens': budget.get('max_tokens', 1000000),
        'maxCostMicrousd': budget.get('max_cost_microusd', 10000000), 'timeoutMs': seconds * 1000,
    }
    # The host's role schema remains authoritative; this is a review candidate, not an installation.
    return definition if not issues else None, issues


def source_file(filename, scope):
    before = filename.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_size > 256 * 1024:
        raise ValueError('Role source must be a regular file of at most 256 KiB: ' + str(filename))
    with filename.open('rb') as handle:
        opened = os.fstat(handle.fileno())
        if (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
            raise ValueError('Role source changed while opening')
        data = handle.read(256 * 1024 + 1)
        after = os.fstat(handle.fileno())
    if len(data) > 256 * 1024 or (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
        raise ValueError('Role source changed while reading')
    text = data.decode('utf-8')
    try:
        definition, issues = candidate(tomllib.loads(text))
        json.dumps(definition)  # Reject TOML types not expressible in the role JSON contract.
    except (ValueError, TypeError, AttributeError) as error:
        definition, issues = None, ['Role requires manual review: ' + type(error).__name__]
    return {'scope': scope, 'source': str(filename), 'sha256': hashlib.sha256(data).hexdigest(),
            'originalToml': text, 'definition': definition, 'issues': issues, 'state': 'review_required'}


def export(args):
    output = Path(args.output).absolute()
    roots = [(scope, Path(value).resolve(strict=True)) for scope, value in [('user', args.user_root), ('project', args.project_root)] if value]
    for _, root in roots:
        if not root.is_dir() or output == root or root in output.parents:
            raise ValueError('Output must be separate from role source directories')
    records, total = [], 0
    for scope, root in roots:
        before = root.stat()
        files = sorted(root.glob('*.toml'))
        if len(files) > 256:
            raise ValueError('Role directory exceeds 256 files')
        for filename in files:
            record = source_file(filename, scope)
            total += len(record['originalToml'].encode('utf-8'))
            if total > 16 * 1024 * 1024:
                raise ValueError('Role source export exceeds 16 MiB')
            records.append(record)
        after = root.stat()
        if (before.st_mtime_ns, before.st_ctime_ns) != (after.st_mtime_ns, after.st_ctime_ns):
            raise ValueError('Role directory changed while reading')
    bundle = {'format': 'eden.legacy-roles-review.v1', 'roles': records,
              'note': 'Review candidates only. Preserve project scope; no role was installed or enabled.'}
    descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w', encoding='utf-8') as handle:
        json.dump(bundle, handle, ensure_ascii=False, indent=2)
        handle.write('\n'); handle.flush(); os.fsync(handle.fileno())
    print(json.dumps({'output': str(output), 'roles': len(records), 'requiresManualMapping': sum(record['definition'] is None for record in records)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--user-root')
    parser.add_argument('--project-root', help='The exact old .edenagent/agents directory')
    parser.add_argument('--output', required=True, help='A new private JSON review file')
    arguments = parser.parse_args()
    if not arguments.user_root and not arguments.project_root:
        parser.error('Provide at least one explicit role source directory')
    export(arguments)

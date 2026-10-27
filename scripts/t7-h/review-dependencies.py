#!/usr/bin/env python3
"""Read-only evidence classification. A/B/C/D are review grades, never approvals."""
import argparse
import collections
import csv
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--evidence', type=Path, default=ROOT / 'evidence/t7-h')
parser.add_argument('--repository', type=Path, required=True, help='quarantined Maven-shaped byte cache; never written')
args = parser.parse_args()
EV = args.evidence
load = lambda p: json.loads(Path(p).read_text())
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
baseline = load(ROOT / 'evidence/t7-g/be-proposed-artifacts.json')['artifacts']
metadata = ROOT / 'evidence/t7-g/be-verification-metadata.UNAPPROVED.xml'
graph = load(EV / 'resolved-graph.json')['configurations']
downloads = {x['path']: x for x in load(EV / 'signature-downloads.json')['artifacts']}
signatures = {x['path']: x for x in map(json.loads, (EV / 'signature-verification.ndjson').read_text().splitlines())}
sources = {x['name'] + '.asc': x for x in load(EV / 'key-sources.json') if x.get('status') == 200}
osv = load(EV / 'osv-results.json')
publisher_supplement = load(EV / 'tomcat-publisher-supplement.json')
advisories = {x['coordinate']: x for x in osv['results']}
base_gavs = {x['coordinate'] for x in baseline}
assert len(baseline) == len({x['path'] for x in baseline}) == 626
assert all(x['approval'] == 'PENDING' for x in baseline)

usage = collections.defaultdict(lambda: collections.defaultdict(set))
selected_artifacts = set()
reasons = collections.defaultdict(set)
requests = collections.defaultdict(set)
version_sets = collections.defaultdict(set)
unresolved = []
for c in graph:
    scope = c['scope'] + ':' + c['configuration']
    for component in c['components']:
        gav = component['gav']
        if gav not in base_gavs:
            assert gav.startswith('com.momentory:') or gav == 'unspecified:unspecified:unspecified', gav
            continue
        usage[gav]['selected'].add(scope)
        reasons[gav].update(component['reason'])
        version_sets[':'.join(gav.split(':')[:2])].add(gav.split(':')[2])
    for a in c['artifacts']:
        selected_artifacts.add((a['gav'], a['file'], a['sha256']))
    for e in c['edges']:
        if 'unresolved' in e:
            unresolved.append(e)
            continue
        gav = e.get('selected')
        if gav not in base_gavs:
            continue
        requests[gav].add(e['requested'])
        relation = 'constraint' if e['constraint'] else 'direct' if e['direct'] else 'transitive'
        usage[gav][relation].add(scope)

ns = {'m': 'http://maven.apache.org/POM/4.0.0', 'v': 'https://schema.gradle.org/dependency-verification'}
def xml(file):
    text = Path(file).read_text()
    assert '<!DOCTYPE' not in text and '<!ENTITY' not in text, file
    return ET.fromstring(text)

metadata_entries = set()
for c in xml(metadata).findall('.//v:component', ns):
    gav = ':'.join(c.attrib[k] for k in ['group', 'name', 'version'])
    for a in c.findall('v:artifact', ns):
        metadata_entries.add((gav, a.attrib['name'], a.find('v:sha256', ns).attrib['value']))
assert metadata_entries == {(a['coordinate'], Path(a['path']).name, a['sha256']) for a in baseline}
assert selected_artifacts == {(a['coordinate'], Path(a['path']).name, a['sha256']) for a in baseline if a['path'].endswith('.jar')}

models = collections.defaultdict(set)
model_ranges = []
model_unresolved_expressions = []
def mutable(value):
    # An embedded '+' (e.g. the literal JDK version 9+181-r4173-1) is not a selector.
    return value.endswith('+') or bool(re.search(r'SNAPSHOT|latest\.|[\[\]()]', value, re.I))

for a in baseline:
    if not a['path'].endswith('.pom'):
        continue
    tree = xml(args.repository / a['path'])
    refs = [(tree.find('m:parent', ns), 'PARENT')]
    refs += [(d, 'IMPORTED_BOM') for d in tree.findall('m:dependencyManagement/m:dependencies/m:dependency', ns)
             if d.findtext('m:scope', '', ns) == 'import']
    for node, role in refs:
        if node is None:
            continue
        values = [node.findtext('m:' + k, '', ns) for k in ['groupId', 'artifactId', 'version']]
        if all(values) and not any('${' in v for v in values):
            models[':'.join(values)].add(role + '_OF:' + a['coordinate'])
    for node in tree.findall('.//m:dependency/m:version', ns):
        value = node.text or ''
        if '${' in value:
            model_unresolved_expressions.append({'model': a['coordinate'], 'expression': value})
        elif mutable(value):
            model_ranges.append({'model': a['coordinate'], 'selector': value})

def joined(items):
    return ';'.join(sorted(set(items)))

def identity(gav, signature):
    """Narrow publisher scopes, reviewed separately from downloaded key material."""
    group = gav.split(':')[0]
    fp = signature.get('fingerprint', '')
    if group.startswith('org.springframework') and fp == '48B086A7D843CFA258E83286928FBF39003C0425':
        anchor = 'spring-official-fingerprint.asc'
        assert '48B0 86A7 D843 CFA2 58E8 3286 928F BF39 003C 0425' in (EV / 'keys' / anchor).read_text()
        return sources[anchor]['url']
    if (group == 'com.fasterxml.jackson' or group.startswith(('com.fasterxml.jackson.', 'tools.jackson'))) and fp == '28118C070CB22A0175A2E8D43D12CA2AC19F3181':
        anchor = 'jackson-project.asc'
        assert fp in (EV / 'keys' / anchor).read_text()
        return sources[anchor]['url']
    rules = [
        ('commons.asc', group in ['commons-codec', 'commons-io', 'commons-logging', 'org.apache.commons']),
        ('httpcomponents.asc', group.startswith('org.apache.httpcomponents')),
        ('log4j.asc', group == 'org.apache.logging.log4j'),
        ('tomcat-project.asc', group.startswith('org.apache.tomcat')),
        ('groovy-project.asc', group == 'org.apache.groovy'),
        ('activemq-project.asc', group == 'org.apache.activemq'),
        ('pulsar-project.asc', group == 'org.apache.pulsar'),
        ('cassandra-project.asc', group.startswith('org.apache.cassandra')),
    ]
    for file, scoped in rules:
        if scoped and file in signature.get('keySources', []) and file in sources:
            return sources[file]['url']
    return ''

rows = []
for i, a in enumerate(baseline, 1):
    location = args.repository / a['path']
    assert location.is_file() and not location.is_symlink() and sha(location) == a['sha256'], a['path']
    gav = a['coordinate']
    group, name, version = gav.split(':')
    u = usage[gav]
    signature_record = signatures.get(a['path'], {'status': 'ABSENT'})
    valid = [s for s in signature_record.get('signatures', []) if s['status'] == 'VALID']
    sig = valid[0] if valid else next(iter(signature_record.get('signatures', [])), {})
    flags = []
    if sig.get('hashAlgorithm') in [1, 2, 3]:
        flags.append('WEAK_SIGNATURE_HASH')
    for field in ['keyExpiresAt', 'primaryExpiresAt', 'signatureExpiresAt']:
        if sig.get(field) and sig[field] < '2026-10-27T00:00:00Z':
            flags.append('EXPIRED_CERTIFICATE_OR_SIGNATURE')
    if sig.get('keyRevokedPacketPresent'):
        flags.append('REVOCATION_PACKET_REQUIRES_REVIEW')
    if valid and not sig.get('bindingVerified'):
        flags.append('SUBKEY_BINDING_UNVERIFIED')
    dynamic = any(mutable(s.split(':', 2)[-1]) for s in requests[gav]) or mutable(version)
    if dynamic:
        flags.append('MUTABLE_SELECTED_REQUEST')
    identity_url = identity(gav, sig) if valid else ''
    if signature_record['status'] == 'INVALID':
        grade, why = 'D', ['SIGNATURE_INVALID']
    elif flags or signature_record['status'] in ['KEY_MISSING', 'PARSE_FAILED']:
        grade, why = 'C', flags + ([] if valid else [signature_record['status']])
        if valid and not identity_url:
            why.append('PUBLISHER_IDENTITY_NOT_ANCHORED')
    elif identity_url:
        grade, why = 'A', ['VALID_SIGNATURE_AND_SCOPED_PUBLISHER_IDENTITY']
    else:
        grade, why = 'B', ['CHECKSUM_MATCH_PUBLISHER_IDENTITY_NOT_ANCHORED' if valid else 'CHECKSUM_MATCH_SIGNATURE_ABSENT']
    scopes = u['selected']
    built = 'buildscript:classpath' in scopes
    runtime = any(s.endswith(':runtimeClasspath') or s.endswith(':productionRuntimeClasspath') for s in scopes)
    test = any(':test' in s for s in scopes)
    marker = name.endswith('.gradle.plugin')
    plugin = marker or name in ['spring-boot-gradle-plugin', 'dependency-management-plugin']
    roles = (['GRADLE_PLUGIN'] if plugin else ['BUILD_TOOL_LIBRARY'] if built else [])
    if runtime:
        roles.append('RUNTIME_LIBRARY')
    if test:
        roles.append('TEST_LIBRARY')
    if not scopes:
        roles.append('RESOLUTION_METADATA_ONLY')
    relation = 'DIRECT' if u['direct'] else 'TRANSITIVE' if u['transitive'] else 'CONSTRAINT_ONLY' if scopes else 'MODEL_SUPPORT_ONLY'
    model_refs = models[gav]
    model_role = 'PLUGIN_MARKER' if marker else 'PARENT' if any(x.startswith('PARENT_') for x in model_refs) else 'BOM' if name.endswith('-bom') or name.endswith('-dependencies') else 'MODULE_DESCRIPTOR' if a['path'].endswith('.module') else 'ARTIFACT_OR_MODEL'
    osv_result = advisories[gav]
    assert osv_result['status'] == 'QUERIED'
    vulnerability_ids = [v['id'] for v in osv_result.get('vulns', [])]
    publisher_candidates = sorted({cve for item in publisher_supplement['candidates'] for cve in item['cves']}) if group == 'org.apache.tomcat.embed' else []
    risk = []
    if built or plugin:
        risk.append('BUILD_EXECUTION')
    if any(x in gav.lower() for x in ['security', 'jose', 'jwt', 'crypto', 'http', 'tomcat', 'netty', 'okhttp', 'postgresql', 'jackson', 'snakeyaml']):
        risk.append('AUTH_CRYPTO_NETWORK_OR_INPUT_PARSER')
    if group.startswith('org.springframework.boot'):
        risk.append('SPRING_BOOT_PLATFORM')
    if grade in ['B', 'C', 'D']:
        risk.append('TRUST_EVIDENCE_GAP')
    if vulnerability_ids:
        risk.append('KNOWN_ADVISORY_VERSION_MATCH')
    if publisher_candidates:
        risk.append('PUBLISHER_PRODUCT_ADVISORY_APPLICABILITY_PENDING')
    if gav == 'junit:junit:4.13.2':
        risk.append('JUNIT4_MAINTENANCE_MODE')
    priority = 'P0' if built or plugin or vulnerability_ids or publisher_candidates or grade == 'D' else 'P1' if runtime or grade == 'C' else 'P2'
    exceptions = []
    if valid and not identity_url:
        exceptions.append('EX-IDENTITY')
    if signature_record['status'] == 'ABSENT':
        exceptions.append('EX-UNSIGNED')
    if 'WEAK_SIGNATURE_HASH' in flags:
        exceptions.append('EX-WEAK-HASH')
    if 'EXPIRED_CERTIFICATE_OR_SIGNATURE' in flags:
        exceptions.append('EX-EXPIRED-KEY')
    if signature_record['status'] == 'KEY_MISSING':
        exceptions.append('EX-MISSING-KEY')
    if vulnerability_ids:
        exceptions.append('EX-VULNERABILITY')
    if publisher_candidates:
        exceptions.append('EX-PUBLISHER-COVERAGE')
    if 'JUNIT4_MAINTENANCE_MODE' in risk:
        exceptions.append('EX-MAINTENANCE')
    if len(version_sets[group + ':' + name]) > 1 or any(r.startswith('between versions ') for r in reasons[gav]):
        exceptions.append('EX-VERSION-SELECTION')
    rows.append(dict(
        review_id='BE-%04d' % i, gav=gav, group=group, artifact=name, version=version,
        filename=location.name, file_type=location.suffix[1:], repository_path=a['path'], sha256=a['sha256'],
        baseline_digest='MATCH', download_source=a['url'], download_source_evidence='PINNED_T7_G_ORIGIN_COMPARISON;T7_H_DETACHED_SIGNATURE_FETCH',
        trust_grade=grade, trust_reasons=joined(why), approval='PENDING_HUMAN_DECISION',
        roles=joined(roles), relation=relation, direct_scopes=joined(u['direct']), transitive_scopes=joined(u['transitive']),
        constraint_scopes=joined(u['constraint']), selected_scopes=joined(scopes), model_role=model_role,
        model_references=joined(model_refs), requested_selectors=joined(requests[gav]),
        selected_versions_for_module=joined(version_sets[group + ':' + name]), selection_reasons=joined(reasons[gav]),
        mutable_selected_request=str(dynamic).lower(), snapshot=str('SNAPSHOT' in version.upper()).lower(),
        signature_status=signature_record['status'], signature_sha256=downloads[a['path']].get('signatureSha256', ''),
        signature_file=downloads[a['path']].get('signatureFile', ''), signer_fingerprint=sig.get('fingerprint', ''),
        signer_key_id=sig.get('keyId', ''), declared_signer_fingerprint=sig.get('declaredFingerprint', ''),
        primary_fingerprint=sig.get('primaryFingerprint', ''), signature_hash_algorithm=sig.get('hashAlgorithm', ''),
        signature_created_at=sig.get('createdAt', ''), key_expires_at=sig.get('keyExpiresAt') or '',
        primary_expires_at=sig.get('primaryExpiresAt') or '', signature_key_sources=joined(sig.get('keySources', [])),
        independent_identity_evidence=identity_url, priority=priority, risk_reasons=joined(risk),
        advisory_ids=joined(vulnerability_ids), advisory_coverage='OSV_EXACT_VERSION_QUERY_NOT_SAFETY_CERTIFICATION',
        publisher_product_advisory_candidates=joined(publisher_candidates),
        exceptions=joined(exceptions), required_human_decision='REVIEW_EVIDENCE_AND_RISK;NO_APPROVAL_ISSUED'))

with (ROOT / 'BE_DEPENDENCY_INVENTORY.csv').open('w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0]), lineterminator='\n'); w.writeheader(); w.writerows(rows)

selected = {g for g in base_gavs if usage[g]['selected']}
direct = {g for g in base_gavs if usage[g]['direct']}
summary = dict(
    files=len(rows), unique_gavs=len(base_gavs), file_types=dict(collections.Counter(r['file_type'] for r in rows)),
    grades={k: sum(r['trust_grade'] == k for r in rows) for k in 'ABCD'},
    grade_gav_counts_nonexclusive={k: len({r['gav'] for r in rows if r['trust_grade'] == k}) for k in 'ABCD'},
    priorities=dict(collections.Counter(r['priority'] for r in rows)),
    selected_gavs=len(selected), selected_jar_files=len(selected_artifacts), metadata_only_gavs=len(base_gavs - selected),
    direct_gavs=len(direct), project_direct_gavs=sum(any(s.startswith('project:') for s in usage[g]['direct']) for g in base_gavs),
    plugin_marker_direct_gavs=sum('buildscript:classpath' in usage[g]['direct'] for g in base_gavs),
    transitive_only_selected_gavs=sum(g not in direct and bool(usage[g]['transitive']) for g in selected),
    constraint_only_selected_gavs=sum(not usage[g]['direct'] and not usage[g]['transitive'] for g in selected),
    build_classpath_jar_files=sum(1 for a in baseline if a['path'].endswith('.jar') and 'buildscript:classpath' in usage[a['coordinate']]['selected']),
    selected_conflict_gavs=sum(any(r.startswith('between versions ') for r in reasons[g]) for g in selected),
    cross_configuration_multiple_version_modules={k: sorted(v) for k, v in version_sets.items() if len(v) > 1},
    unresolved_edges=len(unresolved), mutable_selected_requests=sum(r['mutable_selected_request'] == 'true' for r in rows),
    external_snapshots=sum(r['snapshot'] == 'true' for r in rows),
    signature_statuses=dict(collections.Counter(r['signature_status'] for r in rows)),
    exceptions={key: sum(key in r['exceptions'].split(';') for r in rows) for key in sorted({x for r in rows for x in r['exceptions'].split(';') if x})},
    affected_gavs=len({r['gav'] for r in rows if r['advisory_ids']}), advisory_ids=len({x for r in rows for x in r['advisory_ids'].split(';') if x}),
    tomcat_product_advisory_candidates=publisher_supplement['candidateCveCount'],
    metadata_sha256=sha(metadata), inventory_sha256=sha(ROOT / 'BE_DEPENDENCY_INVENTORY.csv'),
    all_approvals_pending=True, approval_issued=False)
assert sum(summary['grades'].values()) == 626 and not unresolved
(EV / 'trust-summary.json').write_text(json.dumps(summary, indent=2) + '\n')
(EV / 'model-selector-observations.json').write_text(json.dumps(dict(
    note='Raw POM declarations, not proof of selected graph mutability. Property interpolation is handled by Gradle.',
    literal_mutable_declarations=model_ranges, property_expression_occurrences=len(model_unresolved_expressions)), indent=2) + '\n')
print(json.dumps(summary, indent=2))

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

var DIR = path.dirname(new URL(import.meta.url).pathname);
var SECRET = 'leak-project-123';

// 偽の pulumi。MODE で preview の出力を切り替える
var FAKE = `#!/usr/bin/env bash
case "$1" in
  stack) [ "$3" = missing ] && exit 255; exit 0;;
  preview) printf '%s' "$FAKE_OUT"; exit "\${FAKE_EXIT:-0}";;
esac
`;

function run(args, env) {
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-'));
  fs.writeFileSync(path.join(tmp, 'pulumi'), FAKE, { mode: 0o755 });
  var out = path.join(tmp, 'out.txt');
  var r = spawnSync(path.join(DIR, 'pulumi-preview-summary.sh'), args, {
    env: { ...process.env, PATH: tmp + ':' + process.env.PATH, PREVIEW_OUT: out, ...env },
    encoding: 'utf8',
  });
  var comment = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  fs.rmSync(tmp, { recursive: true, force: true });
  return { code: r.status, log: r.stdout + r.stderr, comment };
}

function digest(steps, extra) {
  return JSON.stringify({ config: { 'gcp:project': SECRET }, steps, ...extra });
}

describe('pulumi-preview-summary.sh', () => {
  before(() => {
    if (spawnSync('jq', ['--version']).status !== 0) throw new Error('jq が必要');
  });

  it('変更の件数と型・論理名だけをコメントに書く', () => {
    var r = run(['app (stg)', 'stg'], {
      FAKE_OUT: digest([
        { op: 'same', urn: 'urn:pulumi:stg::exvs-app::pulumi:pulumi:Stack::exvs-app-stg' },
        { op: 'update', urn: 'urn:pulumi:stg::exvs-app::gcp:cloudrunv2/service:Service::svc', newState: { outputs: { uri: SECRET } } },
        { op: 'create', urn: 'urn:pulumi:stg::exvs-app::pulumi:pulumi:Stack$gcp:dns/recordSet:RecordSet::a::b' },
      ]),
    });
    assert.strictEqual(r.code, 0);
    assert.match(r.comment, /create: 1 \/ update: 1/);
    assert.match(r.comment, /- update `gcp:cloudrunv2\/service:Service` `svc`/);
    assert.match(r.comment, /- create `gcp:dns\/recordSet:RecordSet` `a::b`/);
    assert.ok(!r.comment.includes(SECRET));
    assert.ok(!r.log.includes(SECRET));
  });

  it('StackReference の read だけなら変更なしと書く', () => {
    var r = run(['app (prod)', 'prod'], {
      FAKE_OUT: digest([{ op: 'read', urn: 'urn:pulumi:prod::exvs-app::pulumi:pulumi:StackReference::organization/exvs-shared/shared' }]),
    });
    assert.strictEqual(r.code, 0);
    assert.match(r.comment, /### app \(prod\)\n変更なし/);
  });

  it('preview が失敗したら非ゼロで終わり、コメントには失敗とだけ書く', () => {
    var r = run(['shared', 'shared'], {
      FAKE_OUT: digest([], { diagnostics: [{ severity: 'error', message: 'boom' }] }),
      FAKE_EXIT: '1',
    });
    assert.notStrictEqual(r.code, 0);
    assert.match(r.comment, /preview 失敗/);
    assert.match(r.log, /\[error\] boom/);
  });

  it('JSON として読めない出力は中身をログに出さず失敗にする', () => {
    var r = run(['shared', 'shared'], { FAKE_OUT: 'warning: something\n' + digest([]) });
    assert.notStrictEqual(r.code, 0);
    assert.match(r.comment, /出力を解析できない/);
    assert.ok(!r.log.includes(SECRET));
  });

  it('失敗かつ JSON でない出力は pulumi の終了コードを返す', () => {
    var r = run(['shared', 'shared'], { FAKE_OUT: 'panic ' + SECRET, FAKE_EXIT: '255' });
    assert.strictEqual(r.code, 255);
    assert.match(r.comment, /出力を解析できない/);
    assert.ok(!r.log.includes(SECRET));
  });

  it('JSON の形が想定外でも中身を出さず失敗にする', () => {
    for (var extra of [{ diagnostics: SECRET }, { steps: [{ op: 'update' }] }]) {
      var r = run(['shared', 'shared'], { FAKE_OUT: digest([], extra) });
      assert.notStrictEqual(r.code, 0);
      assert.match(r.comment, /出力を解析できない/);
      assert.ok(!r.log.includes(SECRET));
    }
  });

  it('出力が空でも緑にしない', () => {
    var r = run(['shared', 'shared'], { FAKE_OUT: '' });
    assert.notStrictEqual(r.code, 0);
    assert.match(r.comment, /出力を解析できない/);
  });

  it('スタックが無ければスキップする', () => {
    var r = run(['x', 'missing'], {});
    assert.strictEqual(r.code, 0);
    assert.match(r.comment, /stack not initialized, skipping/);
  });
});

describe('mask-gcp-ids.sh', () => {
  function mask(env) {
    return spawnSync(path.join(DIR, 'mask-gcp-ids.sh'), [], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });
  }
  var OK = { SA: 'gha@my-proj-1.iam.gserviceaccount.com', WIF_PROVIDER: 'projects/123456/locations/global/workloadIdentityPools/p/providers/q' };

  it('プロジェクト ID と番号をマスクに登録する', () => {
    var r = mask(OK);
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '::add-mask::my-proj-1\n::add-mask::123456\n');
  });

  it('サービスアカウントの形式が想定外なら失敗する', () => {
    for (var sa of ['broken', 'gha@my-proj-1.example.com', 'gha@x\nleaked-proj.iam.gserviceaccount.com']) {
      var r = mask({ ...OK, SA: sa });
      assert.strictEqual(r.status, 1, sa);
      assert.ok(!r.stdout.includes('add-mask'), sa);
    }
  });

  it('WIF provider から番号を取り出せなければ失敗する', () => {
    for (var wp of ['pools/p', 'projects/1/x', 'projects/123456/x\n987654']) {
      var r = mask({ ...OK, WIF_PROVIDER: wp });
      assert.strictEqual(r.status, 1, wp);
      assert.ok(!r.stdout.includes('add-mask'), wp);
      assert.ok(!r.stdout.includes('987654'), wp);
    }
  });

  it('未設定なら形式エラーと区別して知らせる', () => {
    var r = mask({ ...OK, SA: '' });
    assert.strictEqual(r.status, 1);
    assert.match(r.stdout, /未設定/);
  });
});

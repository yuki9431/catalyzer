import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

var DIR = path.dirname(new URL(import.meta.url).pathname);
var SECRET = 'leak-project-123';

// 偽の tofu。PR の身元は refresh できず lock も取れないので、両方を外さない plan は失敗させる
var FAKE = `#!/usr/bin/env bash
printf '%s\n' "$*" >"$FAKE_ARGS"
[[ " $* " == *" -refresh=false "* && " $* " == *" -lock=false "* ]] || exit 97
printf '%s' "$FAKE_OUT"
exit "\${FAKE_EXIT:-0}"
`;

function run(env) {
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-'));
  fs.writeFileSync(path.join(tmp, 'tofu'), FAKE, { mode: 0o755 });
  var out = path.join(tmp, 'out.txt');
  var argsFile = path.join(tmp, 'args.txt');
  var r = spawnSync(path.join(DIR, 'tofu-plan-summary.sh'), ['app (stg)', 'infra/app', '-var-file=stg.tfvars'], {
    env: { ...process.env, PATH: tmp + ':' + process.env.PATH, PLAN_OUT: out, FAKE_ARGS: argsFile, ...env },
    encoding: 'utf8',
  });
  var comment = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  var args = fs.existsSync(argsFile) ? fs.readFileSync(argsFile, 'utf8') : '';
  fs.rmSync(tmp, { recursive: true, force: true });
  return { code: r.status, log: r.stdout + r.stderr, comment, args };
}

function lines(...objs) {
  return objs.map((o) => JSON.stringify(o)).join('\n') + '\n';
}
var VERSION = { type: 'version', '@message': 'OpenTofu 1.13.9' };
function change(action, addr) {
  return { type: 'planned_change', '@message': `${addr}: ${SECRET}`, change: { action, resource: { addr } } };
}
function diag(severity, summary) {
  return { type: 'diagnostic', diagnostic: { severity, summary, detail: SECRET } };
}

describe('tofu-plan-summary.sh', () => {
  before(() => {
    if (spawnSync('jq', ['--version']).status !== 0) throw new Error('jq が必要');
  });

  it('変更の件数とアドレスだけをコメントに書く', () => {
    var r = run({
      FAKE_OUT: lines(VERSION, change('update', 'google_cloud_run_v2_service.app'), change('create', 'google_project_iam_member.sa["gha-pr x"]'), diag('warning', 'w')),
      FAKE_EXIT: '2',
    });
    assert.strictEqual(r.code, 0);
    assert.match(r.comment, /create: 1 \/ update: 1/);
    assert.match(r.comment, /- update `google_cloud_run_v2_service.app`/);
    assert.match(r.comment, /- create `google_project_iam_member.sa\["gha-pr x"\]`/);
    assert.match(r.log, /\[warning\] w/);
    assert.ok(!r.comment.includes(SECRET));
    assert.ok(!r.log.includes(SECRET));
  });

  it('変更が無ければ変更なしと書く', () => {
    var r = run({ FAKE_OUT: lines(VERSION, { type: 'change_summary', changes: { add: 0 } }) });
    assert.strictEqual(r.code, 0);
    assert.match(r.comment, /### app \(stg\)\n変更なし/);
  });

  it('refresh も lock もせず、渡した引数を plan に足す', () => {
    var r = run({ FAKE_OUT: lines(VERSION) });
    assert.strictEqual(r.code, 0);
    assert.match(r.args, /^-chdir=infra\/app plan -json .*-lock=false -refresh=false -detailed-exitcode -var-file=stg\.tfvars$/m);
  });

  it('plan が失敗したら非ゼロで終わり、コメントには失敗とだけ書く', () => {
    var r = run({ FAKE_OUT: lines(VERSION, diag('error', 'boom')), FAKE_EXIT: '1' });
    assert.strictEqual(r.code, 1);
    assert.match(r.comment, /plan 失敗/);
    assert.match(r.log, /\[error\] boom/);
  });

  it('JSON として読めない出力は中身をログに出さず失敗にする', () => {
    var r = run({ FAKE_OUT: 'warning: ' + SECRET + '\n' + lines(VERSION) });
    assert.notStrictEqual(r.code, 0);
    assert.match(r.comment, /出力を解析できない/);
    assert.ok(!r.log.includes(SECRET));
  });

  it('失敗かつ JSON でない出力は tofu の終了コードを返す', () => {
    var r = run({ FAKE_OUT: 'panic ' + SECRET, FAKE_EXIT: '3' });
    assert.strictEqual(r.code, 3);
    assert.match(r.comment, /出力を解析できない/);
    assert.ok(!r.log.includes(SECRET));
  });

  it('JSON の形が想定外でも中身を出さず失敗にする', () => {
    for (var bad of [[SECRET], { type: 'planned_change', change: { action: 'update', resource: {} } }, { type: 1 }, { type: 'diagnostic', diagnostic: SECRET }]) {
      var r = run({ FAKE_OUT: lines(VERSION, bad) });
      assert.notStrictEqual(r.code, 0);
      assert.match(r.comment, /出力を解析できない/);
      assert.ok(!r.log.includes(SECRET));
    }
  });

  it('出力が空でも成功にしない', () => {
    var r = run({ FAKE_OUT: '' });
    assert.notStrictEqual(r.code, 0);
    assert.match(r.comment, /出力を解析できない/);
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

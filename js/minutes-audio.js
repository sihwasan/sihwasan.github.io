/* 회의록 녹음 파일 (113 sql · cloudflare/audio)
 *
 * 회의록마다 회의 녹음을 붙여 두고 들려준다.
 * 녹음은 Cloudflare R2(공개 접근 꺼짐)에 20MB씩 나누어 올리고,
 * 들을 때는 녹음 창구가 들을 자격을 Supabase에 확인한 뒤 4시간짜리 재생 주소를 내어 준다.
 *
 *   올리기·지우기   : 서기 · 회록서기
 *   늘 들을 수 있음 : 서기 · 회록서기 · 노회장 · 간사
 *   열람 허용 설정  : 서기 · 노회장 — 기간을 정해 모든 회원 또는 고른 회원이 듣게 한다
 *
 * 쓰는 법
 *   SHSAudio.mountMinutes(box, user, { id: 회의록 번호, title: 회의록 제목 });   // 회의록 화면
 *   SHSAudio.mountMine(box, user);                                            // 회의 녹음 듣기 화면
 */
var SHSAudio = (function () {

  var BASE = 'https://sihwasan-audio.sihwasan.workers.dev';
  var PART = 20 * 1024 * 1024;              /* 한 조각 20MB */
  var MAX = 1024 * 1024 * 1024;             /* 녹음 하나 1GB까지 */
  var ACCEPT = 'audio/*,.m4a,.mp3,.aac,.wav,.ogg,.opus,.webm,.amr,.3gp,.flac,.wma';
  var STAFF_TEXT = '서기·회록서기·노회장·간사';

  function e(s) { return SHS.esc(s); }
  function db() { return SHSCloud.init(); }

  /* 녹음 칸 모양 — 회의록 화면과 듣기 화면이 함께 쓴다 */
  var CSS =
    '.ma-box h3{margin-top:0}' +
    '.ma-box [hidden]{display:none!important}' +
    '.ma-item{border-top:1px solid var(--gray-2);padding:12px 0}' +
    '.ma-box h3+.ma-item{border-top:none;padding-top:2px}' +
    '.ma-head{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline}' +
    '.ma-meta,.ma-dim{color:var(--gray-5);font-size:0.82rem}' +
    '.ma-note{font-size:0.88rem;margin-top:4px}' +
    '.ma-share{font-size:0.84rem;color:var(--gray-7);margin:6px 0 8px}' +
    '.ma-btns{display:flex;flex-wrap:wrap;gap:6px}' +
    '.ma-player audio{width:100%;margin-top:10px}' +
    '.ma-sharebox{margin-top:10px;padding:12px 14px;background:var(--gray-1,#f4f5f8);border-radius:8px}' +
    '.ma-radios{display:flex;flex-wrap:wrap;gap:6px 18px;margin-bottom:10px}' +
    '.ma-radio{font-weight:400;font-size:0.9rem;cursor:pointer}' +
    '.ma-radio input{width:auto;margin:0 4px 0 0}' +
    '.ma-dates .field{flex:1 1 150px;min-width:150px}' +
    '.ma-pick input[data-mafind]{width:100%;box-sizing:border-box;margin-top:4px;padding:8px 10px;' +
      'border:1px solid var(--gray-3,#ccc);border-radius:6px;font-size:0.92rem}' +
    '.ma-people{max-height:240px;overflow:auto;overscroll-behavior:contain;border:1px solid var(--gray-2);' +
      'border-radius:6px;background:#fff;padding:2px 10px;margin:6px 0}' +
    '.ma-person{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center;padding:7px 0;font-weight:400;' +
      'font-size:0.9rem;cursor:pointer;border-bottom:1px solid var(--gray-2)}' +
    '.ma-person:last-child{border-bottom:none}' +
    '.ma-person input{width:auto;margin:0}' +
    '.ma-up{margin-top:16px;padding-top:14px;border-top:1px dashed var(--gray-2)}' +
    '.ma-up h4{margin:0 0 8px}' +
    '.ma-prog{margin-top:10px;font-size:0.86rem}' +
    '.ma-prog progress{width:220px;max-width:70%;vertical-align:middle}' +
    '.ma-badge{display:inline-block;margin-left:6px;padding:0 6px;border-radius:3px;background:var(--navy);' +
      'color:#fff;font-size:0.72rem;vertical-align:middle}';
  (function () {
    if (document.getElementById('ma-css')) return;
    var st = document.createElement('style');
    st.id = 'ma-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  })();

  /* ---------- 누가 무엇을 (화면에서 단추를 보일지 정할 때만 쓴다 — 실제 판단은 서버가 한다) ---------- */
  function isRecorder(u) { return !!(u && u.role === 'officer' && String(u.title || '').trim() === '회록서기'); }
  function canUpload(u) { return !!u && (u.role === 'clerk' || u.role === 'superadmin' || isRecorder(u)); }
  function canShare(u) { return !!u && (u.role === 'clerk' || u.role === 'president' || u.role === 'superadmin'); }

  /* ---------- 날짜 ---------- */
  function kstToday() {
    return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  }
  function addDays(ymd, n) {
    var d = new Date(ymd + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function md(ymd) {
    var m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? Number(m[2]) + '월 ' + Number(m[3]) + '일' : '';
  }
  function size(n) {
    n = Number(n || 0);
    return n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB';
  }

  /* 지금 누가 들을 수 있는지 한 줄로 */
  function shareText(a) {
    var base = STAFF_TEXT;
    if (!a || a.share_scope === 'none' || !a.share_from || !a.share_until) return base + '만';
    var t = kstToday();
    var who = a.share_scope === 'all' ? '모든 회원' : '고른 회원 ' + (a.share_users || []).length + '분';
    var when = md(a.share_from) + ' ~ ' + md(a.share_until);
    var state = t < a.share_from ? ' (아직 시작 전)' : t > a.share_until ? ' (기간 끝남)' : ' (지금 들을 수 있음)';
    return base + ' + ' + who + ' · ' + when + state;
  }

  /* ---------- 녹음 창구와 이야기하기 ---------- */
  function token() {
    return db().then(function (c) {
      return c.auth.getSession().then(function (r) {
        var t = r && r.data && r.data.session && r.data.session.access_token;
        if (!t) throw new Error('로그인이 확인되지 않았습니다.');
        return t;
      });
    });
  }
  function call(path, body) {
    return token().then(function (t) {
      return fetch(BASE + path, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {})
      });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || ('녹음 보관소가 응답하지 않습니다. (' + r.status + ')'));
        return j;
      });
    });
  }
  /* 한 조각 올리기 — 진행 막대를 위해 XHR을 쓴다 */
  function putPart(t, key, uploadId, n, blob, onBytes) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open('PUT', BASE + '/up/part?key=' + encodeURIComponent(key) +
        '&uploadId=' + encodeURIComponent(uploadId) + '&n=' + n);
      x.setRequestHeader('Authorization', 'Bearer ' + t);
      x.upload.onprogress = function (ev) { if (ev.lengthComputable && onBytes) onBytes(ev.loaded); };
      x.onload = function () {
        var j = {};
        try { j = JSON.parse(x.responseText || '{}'); } catch (err) {}
        if (x.status >= 200 && x.status < 300 && j.etag) resolve(j);
        else reject(new Error(j.error || ('조각을 올리지 못했습니다. (' + x.status + ')')));
      };
      x.onerror = function () { reject(new Error('인터넷 연결이 끊겼습니다.')); };
      x.send(blob);
    });
  }

  /* 파일 하나를 올리고 회의록에 붙인다 */
  function upload(file, doc, note, user, onProgress) {
    var key = null, uploadId = null, parts = [];
    var total = file.size, n = Math.max(1, Math.ceil(total / PART));
    function tell(done) { if (onProgress) onProgress(Math.min(100, Math.floor(done * 100 / total))); }

    return call('/up/start', { name: file.name }).then(function (s) {
      key = s.key; uploadId = s.uploadId;
      return token();
    }).then(function (t) {
      var chain = Promise.resolve();
      for (var i = 0; i < n; i++) {
        (function (i) {
          chain = chain.then(function () {
            var blob = file.slice(i * PART, Math.min(total, (i + 1) * PART));
            var tries = 0;
            function once() {
              tries++;
              return putPart(t, key, uploadId, i + 1, blob, function (b) { tell(i * PART + b); })
                .catch(function (err) { if (tries < 3) return once(); throw err; });
            }
            return once().then(function (p) { parts.push({ partNumber: p.partNumber, etag: p.etag }); });
          });
        })(i);
      }
      return chain;
    }).then(function () {
      return call('/up/done', { key: key, uploadId: uploadId, parts: parts });
    }).then(function (d) {
      tell(total);
      return db().then(function (c) {
        return c.from('minutes_audio').insert({
          minutes_id: doc.id, minutes_title: doc.title || null,
          file_key: key, file_name: file.name, mime: file.type || null,
          size_bytes: d.size || total, note: note || null,
          uploaded_by: user.id, uploader_name: user.name
        }).select();
      });
    }).then(function (r) {
      if (r.error) throw r.error;
      SHS.logAction('create', '회의 녹음 등록', (doc.title || '') + ' / ' + file.name);
      return r.data && r.data[0];
    }).catch(function (err) {
      /* 다 올리지 못했으면 보관소에 남은 조각·파일을 치운다 */
      if (key && uploadId && parts.length < n) call('/up/abort', { key: key, uploadId: uploadId }).catch(function () {});
      else if (key) call('/del', { key: key }).catch(function () {});
      throw err;
    });
  }

  function playUrl(id) { return call('/sign', { id: id }).then(function (j) { return j.url; }); }

  function remove(a) {
    return db().then(function (c) {
      return c.from('minutes_audio').delete().eq('id', a.id).select('id');
    }).then(function (r) {
      if (r.error) throw r.error;
      if (!(r.data && r.data.length)) throw new Error('지우지 못했습니다. 서기·회록서기만 지울 수 있습니다.');
      SHS.logAction('delete', '회의 녹음 삭제', (a.minutes_title || '') + ' / ' + (a.file_name || ''));
      return call('/del', { key: a.file_key }).catch(function () {});
    });
  }

  /* ---------- 한 녹음 (듣기 · 열람 허용 · 지우기) ---------- */
  var people = null;      /* 열람 허용에서 고를 회원 명단 (한 번만 불러온다) */
  var peopleP = null;     /* 명단을 불러오는 중 */

  function itemHtml(a, user) {
    return '<div class="ma-item" data-ma="' + a.id + '">' +
      '<div class="ma-head"><strong>' + e(a.file_name || '회의 녹음') + '</strong>' +
      '<span class="ma-meta">' + e(size(a.size_bytes)) +
      (a.uploader_name ? ' · ' + e(a.uploader_name) : '') +
      ' · ' + e(String(a.created_at || '').slice(0, 10)) + '</span></div>' +
      (a.note ? '<div class="ma-note">' + e(a.note) + '</div>' : '') +
      '<div class="ma-share">들을 수 있는 분: ' + e(shareText(a)) + '</div>' +
      '<div class="ma-btns">' +
      '<button type="button" class="btn sm" data-maplay="' + a.id + '">듣기</button>' +
      (canShare(user) ? '<button type="button" class="btn ghost sm" data-mashare="' + a.id + '">열람 허용 설정</button>' : '') +
      (canUpload(user) ? '<button type="button" class="btn danger sm" data-madel="' + a.id + '">삭제</button>' : '') +
      '</div>' +
      '<div class="ma-player"></div>' +
      '<div class="ma-sharebox" hidden></div>' +
      '<div class="form-msg" data-mamsg="' + a.id + '"></div>' +
      '</div>';
  }

  function shareForm(a) {
    var scope = a.share_scope || 'none';
    var from = a.share_from || kstToday();
    var until = a.share_until || addDays(kstToday(), 7);
    function radio(v, label) {
      return '<label class="ma-radio"><input type="radio" name="ma-scope-' + a.id + '" value="' + v + '"' +
        (scope === v ? ' checked' : '') + '> ' + label + '</label>';
    }
    return '<div class="ma-sharein">' +
      '<div class="ma-radios">' +
      radio('none', STAFF_TEXT + '만') + radio('all', '모든 회원') + radio('some', '고른 회원') +
      '</div>' +
      '<div class="inline-form ma-dates">' +
      '<div class="field"><label>시작일</label><input type="date" data-mafrom value="' + e(from) + '"></div>' +
      '<div class="field"><label>끝날 (이날까지 들을 수 있습니다)</label><input type="date" data-mauntil value="' + e(until) + '"></div>' +
      '</div>' +
      '<div class="ma-pick" hidden>' +
      '<input type="text" data-mafind placeholder="이름이나 교회로 찾기">' +
      '<div class="ma-people"><p class="ma-dim">회원 명단을 불러오는 중...</p></div>' +
      '<div class="ma-dim" data-macount></div>' +
      '</div>' +
      '<p class="ma-dim">기간이 끝나면 저절로 다시 ' + STAFF_TEXT + '만 들을 수 있게 됩니다. ' +
      '허용하면 새로 듣게 된 분께 알림이 갑니다.</p>' +
      '<button type="button" class="btn sm" data-masave>저장</button> ' +
      '<button type="button" class="btn ghost sm" data-macancel>닫기</button>' +
      '</div>';
  }

  function drawPeople(box, a, chosen) {
    var list = box.querySelector('.ma-people');
    var q = String(box.querySelector('[data-mafind]').value || '').trim();
    var rows = (people || []).filter(function (p) {
      return !q || String(p.name || '').indexOf(q) !== -1 || String(p.church || '').indexOf(q) !== -1;
    });
    list.innerHTML = rows.length ? rows.map(function (p) {
      return '<label class="ma-person"><input type="checkbox" value="' + e(p.id) + '"' +
        (chosen[p.id] ? ' checked' : '') + '> <span>' + e(p.name || '(이름 없음)') + '</span>' +
        '<span class="ma-dim">' + e(p.church || '') + ' · ' + e(SHS.displayRole(p.role, p.title)) + '</span></label>';
    }).join('') : '<p class="ma-dim">찾는 회원이 없습니다.</p>';
    box.querySelector('[data-macount]').textContent = '고른 회원 ' + Object.keys(chosen).length + '분';
    list.querySelectorAll('input[type=checkbox]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        if (cb.checked) chosen[cb.value] = true; else delete chosen[cb.value];
        box.querySelector('[data-macount]').textContent = '고른 회원 ' + Object.keys(chosen).length + '분';
      });
    });
  }

  function openShare(item, a, after) {
    var box = item.querySelector('.ma-sharebox');
    if (!box.hidden) { box.hidden = true; box.innerHTML = ''; return; }
    box.innerHTML = shareForm(a);
    box.hidden = false;
    var chosen = {};
    (a.share_users || []).forEach(function (id) { chosen[id] = true; });
    var pick = box.querySelector('.ma-pick');
    function scope() {
      var r = box.querySelector('input[name="ma-scope-' + a.id + '"]:checked');
      return r ? r.value : 'none';
    }
    function sync() {
      var s = scope();
      box.querySelector('.ma-dates').hidden = s === 'none';
      pick.hidden = s !== 'some';
      if (s === 'some') {
        if (people) { drawPeople(box, a, chosen); return; }
        peopleP = peopleP || db().then(function (c) { return c.rpc('minutes_audio_people'); }).then(function (r) {
          if (r.error) throw r.error;
          people = r.data || [];
        });
        peopleP.then(function () { drawPeople(box, a, chosen); }).catch(function (err) {
          peopleP = null;
          box.querySelector('.ma-people').innerHTML =
            '<p class="ma-dim">회원 명단을 불러오지 못했습니다: ' + e(err.message || err) + '</p>';
        });
      }
    }
    box.querySelectorAll('input[name="ma-scope-' + a.id + '"]').forEach(function (r) {
      r.addEventListener('change', sync);
    });
    box.querySelector('[data-mafind]').addEventListener('input', function () { if (people) drawPeople(box, a, chosen); });
    box.querySelector('[data-macancel]').addEventListener('click', function () { box.hidden = true; box.innerHTML = ''; });
    var save = box.querySelector('[data-masave]');
    save.addEventListener('click', function () {
      if (save.disabled) return;
      var msg = item.querySelector('[data-mamsg="' + a.id + '"]');
      var s = scope();
      var from = box.querySelector('[data-mafrom]').value || null;
      var until = box.querySelector('[data-mauntil]').value || null;
      save.disabled = true;
      save.textContent = '저장 중...';
      msg.className = 'form-msg';
      msg.textContent = '';
      db().then(function (c) {
        return c.rpc('minutes_audio_set_share', {
          p_id: a.id, p_scope: s,
          p_from: s === 'none' ? null : from, p_until: s === 'none' ? null : until,
          p_users: s === 'some' ? Object.keys(chosen) : []
        });
      }).then(function (r) {
        if (r.error) throw r.error;
        SHS.logAction('update', '회의 녹음 열람 허용', (a.minutes_title || '') + ' / ' +
          (s === 'none' ? '관리자만' : (s === 'all' ? '모든 회원' : '고른 회원 ' + Object.keys(chosen).length + '분') +
            ' ' + from + '~' + until));
        if (after) after();
      }).catch(function (err) {
        msg.className = 'form-msg err';
        msg.textContent = '저장하지 못했습니다: ' + (err.message || err);
        save.disabled = false;
        save.textContent = '저장';
      });
    });
    sync();
  }

  function play(item, a) {
    var btn = item.querySelector('[data-maplay]');
    var box = item.querySelector('.ma-player');
    var msg = item.querySelector('[data-mamsg="' + a.id + '"]');
    if (box.querySelector('audio')) { box.querySelector('audio').play().catch(function () {}); return; }
    btn.disabled = true;
    btn.textContent = '여는 중...';
    playUrl(a.id).then(function (u) {
      box.innerHTML = '<audio controls preload="metadata" controlsList="nodownload" src="' + e(u) + '"></audio>';
      var au = box.querySelector('audio');
      /* 한 번에 하나만 — 다른 녹음은 멈춘다 */
      au.addEventListener('play', function () {
        document.querySelectorAll('.ma-player audio').forEach(function (x) { if (x !== au) x.pause(); });
      });
      au.play().catch(function () {});
      btn.textContent = '듣기';
      btn.disabled = false;
    }).catch(function (err) {
      msg.className = 'form-msg err';
      msg.textContent = err.message || String(err);
      btn.textContent = '듣기';
      btn.disabled = false;
    });
  }

  function bindItems(box, list, user, reload) {
    function find(id) { return list.filter(function (x) { return String(x.id) === String(id); })[0]; }
    box.querySelectorAll('[data-maplay]').forEach(function (b) {
      b.addEventListener('click', function () {
        var a = find(b.dataset.maplay);
        if (a) play(b.closest('.ma-item'), a);
      });
    });
    box.querySelectorAll('[data-mashare]').forEach(function (b) {
      b.addEventListener('click', function () {
        var a = find(b.dataset.mashare);
        if (a) openShare(b.closest('.ma-item'), a, reload);
      });
    });
    box.querySelectorAll('[data-madel]').forEach(function (b) {
      b.addEventListener('click', function () {
        var a = find(b.dataset.madel);
        if (!a || b.disabled) return;
        if (!confirm('"' + (a.file_name || '회의 녹음') + '" 녹음을 지웁니다. 되돌릴 수 없습니다. 계속하시겠습니까?')) return;
        b.disabled = true;
        remove(a).then(reload).catch(function (err) {
          alert('지우지 못했습니다: ' + (err.message || err));
          b.disabled = false;
        });
      });
    });
  }

  /* ---------- 회의록 화면 — 이 회의록의 녹음 ---------- */
  function mountMinutes(box, user, doc) {
    if (!box || !doc || !(Number(doc.id) > 0)) return;
    function load() {
      db().then(function (c) {
        return c.from('minutes_audio').select('*').eq('minutes_id', doc.id).order('id');
      }).then(function (r) {
        if (r.error) {
          /* 113 sql 을 아직 실행하지 않았으면 관리자에게만 알린다 */
          box.innerHTML = (canUpload(user) || canShare(user))
            ? '<div class="admin-card ma-box"><h3>회의 녹음</h3><p class="ma-dim">녹음 기능을 준비하는 중입니다. ' +
              '(supabase/113_minutes_audio.sql 실행 필요)</p></div>'
            : '';
          return;
        }
        draw(r.data || []);
      });
    }
    function draw(list) {
      if (!list.length && !canUpload(user)) { box.innerHTML = ''; return; }
      var h = '<div class="admin-card ma-box"><h3>회의 녹음</h3>';
      h += list.length ? list.map(function (a) { return itemHtml(a, user); }).join('')
        : '<p class="ma-dim">아직 붙인 녹음이 없습니다.</p>';
      if (canUpload(user)) {
        h += '<div class="ma-up">' +
          '<h4>녹음 파일 올리기</h4>' +
          '<div class="field"><label>녹음 파일 (휴대전화 녹음 m4a·mp3 등, 1GB까지)</label>' +
          '<input type="file" data-mafile accept="' + ACCEPT + '"></div>' +
          '<div class="field"><label>설명 (선택 · 예: 오전 회무, 오후 계속 회무)</label>' +
          '<input type="text" data-manote maxlength="120"></div>' +
          '<button type="button" class="btn" data-masend>올리기</button>' +
          '<div class="ma-prog" hidden><progress max="100" value="0"></progress> <span></span></div>' +
          '<div class="form-msg" data-maupmsg></div>' +
          '<p class="ma-dim">올린 녹음은 ' + STAFF_TEXT + '만 들을 수 있습니다. ' +
          '서기·노회장이 기간을 정해 다른 회원에게도 열어 줄 수 있습니다.</p></div>';
      }
      h += '</div>';
      box.innerHTML = h;
      bindItems(box, list, user, load);
      bindUpload();
    }
    function bindUpload() {
      var send = box.querySelector('[data-masend]');
      if (!send) return;
      send.addEventListener('click', function () {
        if (send.disabled) return;
        var f = box.querySelector('[data-mafile]').files[0];
        var msg = box.querySelector('[data-maupmsg]');
        if (!f) { msg.className = 'form-msg err'; msg.textContent = '올릴 녹음 파일을 골라 주세요.'; return; }
        if (f.size > MAX) { msg.className = 'form-msg err'; msg.textContent = '녹음 하나는 1GB까지 올릴 수 있습니다.'; return; }
        if (f.type && f.type.indexOf('audio/') !== 0 && f.type.indexOf('video/') !== 0) {
          msg.className = 'form-msg err'; msg.textContent = '소리 파일(m4a·mp3 등)만 올릴 수 있습니다.'; return;
        }
        var prog = box.querySelector('.ma-prog');
        var bar = prog.querySelector('progress'), txt = prog.querySelector('span');
        send.disabled = true;
        send.textContent = '올리는 중...';
        prog.hidden = false;
        msg.className = 'form-msg';
        msg.textContent = '창을 닫거나 다른 화면으로 옮기지 마세요.';
        function stay(ev) { ev.preventDefault(); ev.returnValue = ''; }
        window.addEventListener('beforeunload', stay);
        upload(f, doc, box.querySelector('[data-manote]').value.trim(), user, function (p) {
          bar.value = p; txt.textContent = p + '% (' + size(f.size) + ')';
        }).then(function () {
          window.removeEventListener('beforeunload', stay);
          load();
        }).catch(function (err) {
          window.removeEventListener('beforeunload', stay);
          msg.className = 'form-msg err';
          msg.textContent = '올리지 못했습니다: ' + (err.message || err);
          send.disabled = false;
          send.textContent = '올리기';
          prog.hidden = true;
        });
      });
    }
    load();
  }

  /* ---------- 회의 녹음 듣기 화면 — 지금 내가 들을 수 있는 녹음 ---------- */
  function mountMine(box, user) {
    if (!box) return;
    function load() {
      db().then(function (c) {
        return c.from('minutes_audio').select('*').order('created_at', { ascending: false });
      }).then(function (r) {
        if (r.error) {
          box.innerHTML = '<div class="notice-banner">회의 녹음을 불러오지 못했습니다: ' + e(r.error.message) + '</div>';
          return;
        }
        var list = r.data || [];
        if (!list.length) {
          box.innerHTML = '<div class="notice-banner">지금 들으실 수 있는 회의 녹음이 없습니다. ' +
            '서기·노회장이 열람을 허용하면 알림으로 알려 드립니다.</div>';
          return;
        }
        var groups = {}, order = [];
        list.forEach(function (a) {
          var k = a.minutes_title || '회의록';
          if (!groups[k]) { groups[k] = []; order.push(k); }
          groups[k].push(a);
        });
        box.innerHTML = order.map(function (k) {
          return '<div class="admin-card ma-box"><h3>' + e(k) + '</h3>' +
            groups[k].map(function (a) { return itemHtml(a, user); }).join('') + '</div>';
        }).join('');
        bindItems(box, list, user, load);
      });
    }
    load();
  }

  return {
    mountMinutes: mountMinutes,
    mountMine: mountMine,
    canUpload: canUpload,
    canShare: canShare,
    shareText: shareText
  };
})();

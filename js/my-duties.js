/* 노회에서 맡은 일 (내 시찰 · 내 상비부)
 *
 * 내 정보 화면에서 "나는 어느 시찰이고, 어느 상비부에 배정되어 있으며,
 * 그 안에서 무엇을 맡고 있는가"를 한눈에 보여 준다.
 *
 * 어디서 가져오는가
 *   시찰 소속 : 노회 명단(roster)의 시찰 칸
 *   시찰 직책 : my_sichals()  — 시찰 명부의 시찰장·서기, 또는 따로 지정된 임원
 *   상비부 직책 : my_committees() — 상비부 명부의 부장·서기·회계
 *   상비부 배정 : 상비부 명부의 1·2·3년조 명단에 내 이름이 있는가
 *
 * 이 자료들은 모두 관리자가 <회원 관리>에서 손보는 명단이므로,
 * 여기서는 읽기만 하고 고치지 않는다. 틀린 곳이 있으면 노회 사무실에
 * 알려 달라는 안내를 함께 둔다.
 *
 *   SHSMyDuties.mount(자리, 지금 로그인한 사람)
 */
var SHSMyDuties = (function () {
  'use strict';

  function esc(s) { return SHS.esc(s); }

  /* 명부에는 '김종수 목사(섬기는교회)'처럼 적히므로 첫 낱말만 견준다 */
  function firstWord(s) {
    return String(s || '').trim().split(/[\s(]/)[0];
  }

  /* '이재용, 주강완, 박영수' 를 하나씩 나눈다 */
  function names(s) {
    return String(s || '').split(',').map(function (x) { return x.trim(); })
      .filter(function (x) { return x; });
  }

  function mount(box, user) {
    if (!box) return;
    if (!(user && user.name && window.SHSCloud && SHSCloud.enabled())) {
      box.innerHTML = '<p style="color:var(--gray-5)">서버 로그인 후 보실 수 있습니다.</p>';
      return;
    }

    box.innerHTML = '<p style="color:var(--gray-5)">불러오는 중...</p>';

    SHSCloud.init().then(function (c) {
      function soft(p) { return p.then(function (x) { return x; }, function () { return { data: null }; }); }
      return Promise.all([
        soft(c.from('roster').select('name,church,position,category,sichal,note')
              .eq('name', user.name)),
        soft(c.from('committees').select('*').order('sort')),
        soft(c.rpc('my_committees')),
        soft(c.rpc('my_sichals'))
      ]);
    }).then(function (rs) {
      var roster = (rs[0] && rs[0].data) || [];
      var coms   = (rs[1] && rs[1].data) || [];
      var myCom  = (rs[2] && rs[2].data) || [];
      var mySic  = (rs[3] && rs[3].data) || [];

      /* 노회 명단에서 나를 찾는다. 동명이인이 있을 수 있으므로
       * 소속 교회까지 같은 줄을 먼저 쓴다. */
      var me = roster.filter(function (r) { return r.church === user.church; })[0]
            || (roster.length === 1 ? roster[0] : null);

      draw(me, coms, myCom, mySic, roster.length > 1 && !me);
    }).catch(function (x) {
      box.innerHTML = '<p style="color:var(--gray-5)">불러오지 못했습니다: ' +
        esc((x && x.message) || '') + '</p>';
    });

    function draw(me, coms, myCom, mySic, ambiguous) {
      var h = '<div class="duty-card">';

      /* ---------- 시찰 ---------- */
      var sicName = (me && me.sichal) || '';
      var sicDuty = mySic.filter(function (m) { return !sicName || m.sichal === sicName; })
                         .map(function (m) { return m.duty_name; });
      /* 시찰 명부에는 있는데 노회 명단의 시찰 칸이 비어 있는 경우 */
      if (!sicName && mySic.length) sicName = mySic[0].sichal;

      h += '<div class="duty-row"><div class="duty-k">시찰</div><div class="duty-v">';
      if (sicName) {
        h += '<a href="sichal.html?s=' + encodeURIComponent(sicName) + '">' + esc(sicName) + '</a>';
        h += sicDuty.length
          ? ' <span class="duty-tag">' + sicDuty.map(esc).join('</span> <span class="duty-tag">') + '</span>'
          : ' <span class="duty-plain">소속</span>';
      } else {
        h += '<span class="duty-none">배정된 시찰이 없습니다.</span>';
      }
      h += '</div></div>';

      /* ---------- 상비부 ---------- */
      var dutyOf = {};
      myCom.forEach(function (m) { (dutyOf[m.committee] = dutyOf[m.committee] || []).push(m.duty_name); });

      var mine = [];
      coms.forEach(function (c) {
        var tags = (dutyOf[c.name] || []).slice();
        /* 명부에 적힌 직책도 함께 본다 (my_committees 가 못 알아본 경우 대비) */
        [['head', SHS.headTitle(c.name)], ['clerk', '서기'], ['treasurer', '회계']]
          .forEach(function (p) {
            if (firstWord(c[p[0]]) === user.name && tags.indexOf(p[1]) === -1) tags.push(p[1]);
          });
        /* 상비부는 1·2·3년조, 위원회는 위원 명단
         * (서버가 이미 알려 준 것과 겹치지 않게) */
        (SHS.isBoard(c.name)
          ? [['members', '위원']]
          : [['y1', '1년조'], ['y2', '2년조'], ['y3', '3년조']]
        ).forEach(function (p) {
          if (names(c[p[0]]).indexOf(user.name) !== -1 && tags.indexOf(p[1]) === -1) tags.push(p[1]);
        });
        if (tags.length) mine.push({ name: c.name, tags: tags });
      });

      h += '<div class="duty-row"><div class="duty-k">상비부</div><div class="duty-v">';
      if (mine.length) {
        h += mine.map(function (m) {
          return '<div class="duty-line">' +
            '<a href="committee.html?c=' + encodeURIComponent(m.name) + '">' + esc(m.name) + '</a> ' +
            m.tags.map(function (t) {
              return '<span class="duty-tag' + (/년조$/.test(t) ? ' plain' : '') + '">' + esc(t) + '</span>';
            }).join(' ') +
            '</div>';
        }).join('');
      } else {
        h += '<span class="duty-none">배정된 상비부가 없습니다.</span>';
      }
      h += '</div></div>';

      /* ---------- 명단에서의 분류 ---------- */
      if (me) {
        h += '<div class="duty-row"><div class="duty-k">노회 명단</div><div class="duty-v">' +
          esc(me.category || '-') +
          (me.position ? ' <span class="duty-plain">' + esc(me.position) + '</span>' : '') +
          (me.note ? ' <span class="duty-plain">' + esc(me.note) + '</span>' : '') +
          '</div></div>';
      }

      h += '</div>';

      if (ambiguous) {
        h += '<p style="font-size:0.82rem;color:var(--red)">' +
          '노회 명단에 같은 성함이 여러 분 계셔서 어느 분인지 가리지 못했습니다. ' +
          '위 <strong>소속 교회</strong>를 명단과 똑같이 맞춰 주세요.</p>';
      }
      h += '<p style="font-size:0.82rem;color:var(--gray-5)">' +
        '이 내용은 노회 명단과 상비부·시찰 명부에서 그대로 가져옵니다. ' +
        '틀린 곳이 있으면 노회 사무실(031-486-9993)로 알려 주시기 바랍니다.</p>';

      box.innerHTML = h;
    }
  }

  return { mount: mount };
})();

/* 시찰방 사진첩·게시판
 *
 * 시찰마다 자기 사진과 글을 따로 모아 둔다.
 * 사진은 노회 갤러리와 똑같이 웹 크기로 줄여 Cloudflare R2에 올리고,
 * 홈페이지에는 주소만 적어 둔다. 영상은 노회 갤러리와 같이 유튜브 주소로 받는다.
 *
 * 사진첩에서 고른 사진은 「노회 홈페이지에 게시하기」로 노회 갤러리에 그대로 실린다.
 * 사진을 다시 올리지 않고 같은 주소를 함께 쓰므로 보관 용량이 두 배로 늘지 않는다.
 *
 * 사진첩의 영상 칸 — 노회 갤러리의 영상 칸과 같은 모양이다.
 * 표를 새로 만들지 않고 sichal_photos 에 함께 담는다.
 *   image_url = 유튜브 주소 (사진이면 큰 사진 자리 — 이 주소로 영상인지 가린다)
 *   thumb_url = 썸네일 (따로 올린 그림, 없으면 유튜브 기본 그림)
 *   album     = 영상 제목
 *
 * 쓰는 법 (sichal.html)
 *   var room = SHSRoom.create({ sichal: NAME, user: user, isOfficer: isOfficer });
 *   room.load().then(function () { room.drawBoard(box); });
 */
var SHSRoom = (function () {

  var CATS = ['공지사항', '건의사항', '하고 싶은 말'];
  var FULL_W = 1400, FULL_Q = 0.8;     /* 큰 사진 — 노회 갤러리와 같은 크기 */
  var THUMB_W = 640, THUMB_Q = 0.72;   /* 작은 사진 (목록용) */

  function e(s) { return SHS.esc(s); }

  function ytId(u) {
    var m = String(u || '').match(
      /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([A-Za-z0-9_-]{6,})/);
    return m ? m[1] : '';
  }
  function ytThumb(id) { return 'https://img.youtube.com/vi/' + id + '/hqdefault.jpg'; }
  function ytEmbed(id) {
    return '<div class="feed-vid"><iframe src="https://www.youtube.com/embed/' + e(id) +
      '" title="영상" allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture" ' +
      'allowfullscreen loading="lazy"></iframe></div>';
  }
  /* 사진첩 줄 가운데 영상인 것 (image_url 자리에 유튜브 주소가 있다) */
  function isVid(row) { return !!ytId(row && row.image_url); }
  /* 영상 칸에서 누른 영상을 창에 띄워 바로 재생한다 */
  function playEmbed(id) {
    return '<div class="feed-vid"><iframe src="https://www.youtube.com/embed/' + e(id) +
      '?autoplay=1&playsinline=1&rel=0" title="유튜브 영상" ' +
      'allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>';
  }

  function when(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    if (isNaN(d)) return String(ts).slice(0, 10);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  function dateText(s) {
    var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[1] + '년 ' + Number(m[2]) + '월 ' + Number(m[3]) + '일' : (s || '');
  }

  /* 웹 크기로 줄이기 — 원본을 그대로 올리지 않는다 (노회 갤러리와 같은 방식) */
  function shrink(file, maxW, quality) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(url);
        var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
        var cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        var cx = cv.getContext('2d');
        cx.fillStyle = '#fff';
        cx.fillRect(0, 0, w, h);
        cx.drawImage(img, 0, 0, w, h);
        cv.toBlob(function (b) {
          b ? resolve(b) : reject(new Error('사진을 줄이지 못했습니다.'));
        }, 'image/jpeg', quality);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('사진을 읽지 못했습니다.'));
      };
      img.src = url;
    });
  }

  /* 사진 한 장을 큰 것·작은 것 한 쌍으로 만들어 보관소에 올린다 */
  function putPhoto(file) {
    return Promise.all([
      shrink(file, FULL_W, FULL_Q),
      shrink(file, THUMB_W, THUMB_Q)
    ]).then(function (pair) {
      return SHSPhotos.putPair(pair[0], pair[1]);
    });
  }

  /* 여러 장을 차례로 올리며 진행 상황을 알린다 */
  function putPhotos(files, onStep) {
    var out = [];
    var chain = Promise.resolve();
    Array.prototype.forEach.call(files, function (f, i) {
      chain = chain.then(function () {
        if (onStep) onStep(i + 1, files.length);
        return putPhoto(f).then(function (u) { out.push(u); });
      });
    });
    return chain.then(function () { return out; });
  }

  /* 영상 썸네일 — 한 장만 올려 thumb_url 에 적는다.
   * 보관소(R2)가 설정되지 않았으면 예전처럼 Supabase에 한 쌍으로 올린다. */
  var VTHUMB_W = 960, VTHUMB_Q = 0.82;
  function putThumb(file) {
    return shrink(file, VTHUMB_W, VTHUMB_Q).then(function (b) {
      if (SHSPhotos.enabled()) return SHSPhotos.upload(b, SHSPhotos.newKey('thumb'));
      return SHSPhotos.putPair(b, b).then(function (u) { return u.thumb; });
    });
  }

  /* ---------- 영상 보기 창 ----------
   * 배경을 눌렀다 뗄 때(끌다 놓은 것 말고)·Esc·× 로 닫히고,
   * 열린 동안 뒤 화면은 움직이지 않으며, 닫으면 초점이 누른 자리로 돌아간다. */
  var vp = null, vpBack = null, vpOverflow = '';
  function player() {
    if (vp) return vp;
    vp = document.createElement('div');
    vp.className = 'mdl';
    vp.setAttribute('role', 'dialog');
    vp.setAttribute('aria-modal', 'true');
    vp.setAttribute('aria-label', '영상 보기');
    vp.innerHTML =
      '<div class="mdl-box wide" style="overscroll-behavior:contain">' +
      '<button type="button" class="mdl-close" aria-label="닫기">&times;</button>' +
      '<div class="rv-play" style="margin-top:22px"></div>' +
      '<div class="rv-cap" style="margin-top:10px;font-size:0.92rem;color:var(--gray-7)"></div>' +
      '<div class="rv-desc" style="margin-top:6px;font-size:0.86rem;color:var(--gray-5);white-space:pre-wrap"></div>' +
      '</div>';
    document.body.appendChild(vp);
    vp.querySelector('.mdl-close').addEventListener('click', closePlayer);
    var down = false;
    vp.addEventListener('mousedown', function (ev) { down = (ev.target === vp); });
    vp.addEventListener('click', function (ev) {
      if (down && ev.target === vp) closePlayer();
      down = false;
    });
    document.addEventListener('keydown', function (ev) {
      if (!vp.classList.contains('open')) return;
      if (ev.key === 'Escape') { ev.preventDefault(); closePlayer(); return; }
      if (ev.key !== 'Tab') return;
      /* 열린 동안 Tab 은 창 안에서만 돈다 */
      var fs = Array.prototype.filter.call(
        vp.querySelectorAll('button, iframe, a[href]'), function (x) { return x.offsetParent !== null; });
      if (!fs.length) return;
      var first = fs[0], last = fs[fs.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
      else if (!vp.contains(document.activeElement)) { ev.preventDefault(); first.focus(); }
    });
    return vp;
  }
  function openPlayer(v) {
    var id = ytId(v.image_url);
    if (!id) return;
    var m = player();
    vpBack = document.activeElement;
    m.querySelector('.rv-play').innerHTML = playEmbed(id);
    m.querySelector('.rv-cap').textContent =
      (v.album || '시찰 영상') + (dateText(v.taken) ? ' · ' + dateText(v.taken) : '');
    m.querySelector('.rv-desc').textContent = v.caption || '';
    vpOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    m.classList.add('open');
    m.querySelector('.mdl-close').focus();
  }
  function closePlayer() {
    if (!vp || !vp.classList.contains('open')) return;
    vp.querySelector('.rv-play').innerHTML = '';     /* 소리가 남지 않게 재생기를 걷어 낸다 */
    vp.classList.remove('open');
    document.body.style.overflow = vpOverflow;
    if (vpBack && vpBack.focus && document.contains(vpBack)) vpBack.focus();
    vpBack = null;
  }

  /* ---------- 사진 크게 보기 ---------- */
  var lb = null, lbList = [], lbIdx = 0;
  function lightbox() {
    if (lb) return lb;
    lb = document.createElement('div');
    lb.className = 'lightbox';
    lb.innerHTML =
      '<button class="lb-close" aria-label="닫기">&times;</button>' +
      '<button class="lb-nav" data-d="-1" aria-label="이전" style="position:absolute;left:18px;' +
      'background:none;border:none;color:#fff;font-size:2.4rem;line-height:1">&lsaquo;</button>' +
      '<button class="lb-nav" data-d="1" aria-label="다음" style="position:absolute;right:18px;' +
      'background:none;border:none;color:#fff;font-size:2.4rem;line-height:1">&rsaquo;</button>' +
      '<figure style="margin:0;text-align:center"><img alt="">' +
      '<figcaption style="color:#dfe4ee;font-size:0.86rem;margin-top:10px"></figcaption></figure>';
    document.body.appendChild(lb);
    lb.querySelector('.lb-close').addEventListener('click', close);
    lb.addEventListener('click', function (ev) { if (ev.target === lb) close(); });
    lb.querySelectorAll('.lb-nav').forEach(function (b) {
      b.addEventListener('click', function () { step(+b.dataset.d); });
    });
    document.addEventListener('keydown', function (ev) {
      if (!lb.classList.contains('open')) return;
      if (ev.key === 'Escape') close();
      if (ev.key === 'ArrowLeft') step(-1);
      if (ev.key === 'ArrowRight') step(1);
    });
    function close() { lb.classList.remove('open'); }
    function step(d) {
      if (!lbList.length) return;
      lbIdx = (lbIdx + d + lbList.length) % lbList.length;
      show();
    }
    return lb;
  }
  function show() {
    var p = lbList[lbIdx] || {};
    lb.querySelector('img').src = p.image_url || p.full || '';
    lb.querySelector('figcaption').textContent =
      (p.caption || '') + (lbList.length > 1 ? '   (' + (lbIdx + 1) + ' / ' + lbList.length + ')' : '');
  }
  function openLb(list, i) {
    lbList = list || []; lbIdx = i || 0;
    lightbox().classList.add('open');
    show();
  }

  /* ================================================================= */
  function create(o) {
    var NAME = o.sichal;
    var user = o.user;
    var isOfficer = !!o.isOfficer;                 /* 시찰장·서기·노회 관리자 */
    var canManage = !!(window.SHSAuth && SHSAuth.canManageMembers && SHSAuth.canManageMembers(user));

    var posts = [], comments = [], photos = [], videos = [], galCats = [];
    var upKind = 'photo';     /* 올리기 칸: photo(사진) / video(유튜브 영상) */
    var vtFile = null;        /* 새 영상에 붙일 썸네일 그림 */
    var vtTarget = null;      /* 썸네일을 바꾸는 중인 영상 */
    var vtEdit = null;        /* 썸네일 바꾸기에 쓰는 숨은 파일 고르기 */
    var boardCat = '전체';
    var openId = null;        /* 펼쳐 본 게시글 */
    var editId = null;        /* 고쳐 쓰는 중인 게시글 */
    var album = null;         /* 열어 본 앨범 이름 */
    var picked = {};          /* 노회 게시용으로 고른 사진 번호 */
    var pubOpen = false;      /* 노회 게시 상자를 펼쳤는가 */
    var boardEl = null, photoEl = null;

    function db() { return SHSCloud.init(); }
    function fail(x) { alert('처리하지 못했습니다: ' + ((x && x.message) || x)); }
    function mine(row) { return row && row.author_id && row.author_id === user.id; }
    function canEdit(row) { return isOfficer || mine(row); }

    /* ---------- 불러오기 ---------- */
    function load() {
      return db().then(function (c) {
        return Promise.all([
          c.from('sichal_posts').select('*').eq('sichal', NAME)
            .order('pinned', { ascending: false }).order('id', { ascending: false })
            .then(function (x) { return x; }, function () { return { data: [] }; }),
          c.from('sichal_post_comments').select('*').order('id')
            .then(function (x) { return x; }, function () { return { data: [] }; }),
          c.from('sichal_photos').select('*').eq('sichal', NAME)
            .order('sort').order('id')
            .then(function (x) { return x; }, function () { return { data: [] }; }),
          c.from('gallery_categories').select('name').order('sort')
            .then(function (x) { return x; }, function () { return { data: [] }; })
        ]);
      }).then(function (rs) {
        posts = ((rs[0] && rs[0].data) || []).filter(function (p) { return !p.deleted_at; });
        comments = (rs[1] && rs[1].data) || [];
        var rows = (rs[2] && rs[2].data) || [];
        photos = rows.filter(function (p) { return !isVid(p); });
        /* 영상은 앨범에 섞지 않고 따로 — 날짜가 늦은 것부터 */
        videos = rows.filter(isVid).sort(function (a, b) {
          var ta = a.taken || '', tb = b.taken || '';
          return ta < tb ? 1 : ta > tb ? -1 : (b.id - a.id);
        });
        galCats = ((rs[3] && rs[3].data) || []).map(function (x) { return x.name; });
      }, function () { /* 95 sql 을 아직 실행하지 않았어도 화면은 열린다 */ });
    }
    function reload(after) {
      load().then(function () { if (after) after(); });
    }

    /* ================= 게시판 ================= */

    function catCount(k) {
      return k === '전체' ? posts.length
        : posts.filter(function (p) { return p.cat === k; }).length;
    }
    function shown() {
      return boardCat === '전체' ? posts
        : posts.filter(function (p) { return p.cat === boardCat; });
    }
    function cmtOf(id) {
      return comments.filter(function (x) { return String(x.post_id) === String(id); });
    }

    function drawBoard(box) {
      boardEl = box || boardEl;
      var h = '';

      h += '<div class="notice-banner" style="margin-bottom:16px">' +
        '<strong>' + e(NAME) + ' 게시판</strong>입니다. 공지사항·건의사항·하고 싶은 말을 나누어 적습니다. ' +
        '사진은 끌어다 놓으면 웹 크기로 줄여 올라가고, 영상은 유튜브 주소를 적으시면 됩니다.</div>';

      h += '<div class="tabs sub-tabs" id="bd-cats">' +
        ['전체'].concat(CATS).map(function (k) {
          return '<button class="' + (boardCat === k ? 'active' : '') + '" data-bc="' + e(k) + '">' +
            e(k) + ' (' + catCount(k) + ')</button>';
        }).join('') + '</div>';

      var open = openId ? posts.filter(function (p) { return String(p.id) === String(openId); })[0] : null;
      if (open) h += postView(open);

      var list = shown();
      if (!list.length) {
        h += '<p style="color:var(--gray-5)">아직 올라온 글이 없습니다.</p>';
      } else {
        h += '<div style="overflow-x:auto"><table class="tbl"><thead><tr>' +
          '<th style="width:96px">분류</th><th class="left">제목</th>' +
          '<th style="width:110px">올린 이</th><th style="width:150px">올린 때</th>' +
          '<th style="width:64px">댓글</th></tr></thead><tbody>';
        list.forEach(function (p) {
          var n = cmtOf(p.id).length;
          var nPic = (p.images || []).length + (ytId(p.link_url) ? 1 : 0);
          h += '<tr' + (String(p.id) === String(openId) ? ' style="background:var(--gray-1,#f4f5f8)"' : '') + '>' +
            '<td><span class="role-badge">' + e(p.cat) + '</span></td>' +
            '<td class="left"><a href="#" data-bopen="' + p.id + '" style="color:var(--navy)">' +
            (p.pinned ? '<strong>[고정] </strong>' : '') + e(p.title) + '</a>' +
            (nPic ? ' <span style="font-size:0.78rem;color:var(--gray-5)">' +
              (ytId(p.link_url) ? '▶' : '') + ((p.images || []).length ? ' 사진 ' + p.images.length : '') +
              '</span>' : '') + '</td>' +
            '<td>' + e(p.author_name || '') + '</td>' +
            '<td>' + e(when(p.created_at)) + '</td>' +
            '<td>' + (n || '') + '</td></tr>';
        });
        h += '</tbody></table></div>';
      }

      if (o.canWrite !== false) h += postForm();
      box.innerHTML = h;
      bindBoard(box);
    }

    function postView(p) {
      var yid = ytId(p.link_url);
      var cs = cmtOf(p.id);
      var h = '<div class="admin-card" style="margin-bottom:22px" id="bd-view">' +
        '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start">' +
        '<div><h3 style="margin:0 0 4px">' + (p.pinned ? '[고정] ' : '') + e(p.title) + '</h3>' +
        '<span style="font-size:0.84rem;color:var(--gray-5)">' +
        '<span class="role-badge">' + e(p.cat) + '</span> ' + e(p.author_name || '') +
        ' · ' + e(when(p.created_at)) + '</span></div>' +
        '<div style="white-space:nowrap">' +
        (canEdit(p) ? '<button class="btn ghost sm" data-bedit="' + p.id + '">수정</button> ' +
                      '<button class="btn danger sm" data-bdel="' + p.id + '">삭제</button> ' : '') +
        '<button class="btn ghost sm" id="bd-close">닫기</button></div></div>';

      if (p.body) {
        h += '<div style="margin:14px 0;white-space:pre-wrap;line-height:1.7">' + e(p.body) + '</div>';
      }
      if (yid) h += '<div style="margin:14px 0;max-width:640px">' + ytEmbed(yid) + '</div>';
      else if (p.link_url) {
        h += '<div style="margin:10px 0"><a href="' + e(p.link_url) + '" target="_blank" rel="noopener" ' +
          'style="color:var(--navy);text-decoration:underline">링크 보기</a></div>';
      }
      if ((p.images || []).length) {
        h += '<div class="alb-photos" style="margin:14px 0">' + p.images.map(function (im, i) {
          return '<img loading="lazy" src="' + e(im.thumb || im.full) + '" alt="" ' +
            'data-bimg="' + p.id + ':' + i + '" style="cursor:zoom-in">';
        }).join('') + '</div>';
      }

      /* 댓글 */
      h += '<div class="feed-cmt" style="border-top:1px solid var(--gray-2);margin-top:14px;padding-top:10px">';
      h += cs.length
        ? cs.map(function (x) {
            return '<div class="row"><span class="n">' + e(x.author_name || '') + '</span>' +
              '<span>' + e(x.body) + '</span>' +
              '<span style="color:var(--gray-4);font-size:0.76rem;margin-left:8px">' + e(when(x.created_at)) + '</span>' +
              ((x.user_id === user.id || isOfficer)
                ? '<button data-cdel="' + x.id + '">지우기</button>' : '') + '</div>';
          }).join('')
        : '<div style="color:var(--gray-5)">아직 댓글이 없습니다.</div>';
      h += '</div>';
      if (o.canWrite !== false) {
        h += '<div class="feed-in" style="border-top:none;padding-left:0;padding-right:0">' +
          '<input type="text" id="bd-cmt" placeholder="댓글을 적어 주세요" maxlength="300">' +
          '<button id="bd-cmt-send">올리기</button></div>';
      }
      return h + '</div>';
    }

    function postForm() {
      var p = editId ? posts.filter(function (x) { return String(x.id) === String(editId); })[0] : null;
      return '<div class="admin-card" style="margin-top:20px" id="bd-form">' +
        '<h3 style="margin-top:0" id="bd-ftitle">' + (p ? '글 수정' : '글쓰기') + '</h3>' +
        '<div class="inline-form">' +
        '<div class="field" style="flex:0 0 170px"><label>분류</label><select id="bd-cat">' +
        CATS.map(function (k) {
          return '<option value="' + e(k) + '"' + (p && p.cat === k ? ' selected' : '') + '>' + e(k) + '</option>';
        }).join('') + '</select></div>' +
        '<div class="field"><label>제목</label><input type="text" id="bd-title" maxlength="120" value="' +
        (p ? e(p.title) : '') + '"></div>' +
        (isOfficer
          ? '<div class="field" style="flex:0 0 130px"><label>맨 위 고정</label>' +
            '<label style="font-weight:400;font-size:0.88rem"><input type="checkbox" id="bd-pin" ' +
            'style="width:auto;margin-right:6px"' + (p && p.pinned ? ' checked' : '') + '>고정하기</label></div>'
          : '') +
        '</div>' +
        '<div class="field"><label>내용</label><textarea id="bd-body" rows="5">' +
        (p ? e(p.body || '') : '') + '</textarea></div>' +
        '<div class="field"><label>유튜브 영상 주소 (선택)</label>' +
        '<input type="text" id="bd-link" placeholder="https://youtu.be/..." value="' +
        (p ? e(p.link_url || '') : '') + '"></div>' +
        '<div class="field"><label>사진 (선택 · 여러 장 가능 · 웹 크기로 줄여 올립니다)</label>' +
        '<input type="file" id="bd-files" accept="image/*" multiple></div>' +
        (p && (p.images || []).length
          ? '<p style="font-size:0.82rem;color:var(--gray-5);margin:-6px 0 12px">' +
            '이미 올린 사진 ' + p.images.length + '장은 그대로 두고, 새로 고르신 사진이 뒤에 이어 붙습니다.</p>'
          : '') +
        '<button class="btn" id="bd-save">' + (p ? '수정 저장' : '올리기') + '</button> ' +
        (p ? '<button class="btn ghost" id="bd-cancel">취소</button>' : '') +
        '<div class="form-msg" id="bd-msg"></div></div>';
    }

    function bindBoard(box) {
      box.querySelectorAll('#bd-cats button').forEach(function (b) {
        b.addEventListener('click', function () {
          boardCat = b.dataset.bc; openId = null; drawBoard(box);
        });
      });
      box.querySelectorAll('a[data-bopen]').forEach(function (a) {
        a.addEventListener('click', function (ev) {
          ev.preventDefault();
          openId = (String(openId) === a.dataset.bopen) ? null : a.dataset.bopen;
          editId = null;
          drawBoard(box);
          var v = document.getElementById('bd-view');
          if (v) v.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      });
      var cl = document.getElementById('bd-close');
      if (cl) cl.addEventListener('click', function () { openId = null; drawBoard(box); });

      box.querySelectorAll('img[data-bimg]').forEach(function (im) {
        im.addEventListener('click', function () {
          var k = im.dataset.bimg.split(':');
          var p = posts.filter(function (x) { return String(x.id) === k[0]; })[0];
          if (!p) return;
          openLb(p.images.map(function (g) {
            return { image_url: g.full || g.thumb, caption: p.title };
          }), +k[1]);
        });
      });

      box.querySelectorAll('button[data-bedit]').forEach(function (b) {
        b.addEventListener('click', function () {
          editId = b.dataset.bedit; drawBoard(box);
          var f = document.getElementById('bd-form');
          if (f) f.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      });
      box.querySelectorAll('button[data-bdel]').forEach(function (b) {
        b.addEventListener('click', function () {
          var p = posts.filter(function (x) { return String(x.id) === b.dataset.bdel; })[0];
          if (!p) return;
          if (!confirm('「' + p.title + '」 글을 지웁니다. 붙어 있는 사진과 댓글도 함께 사라집니다. 계속하시겠습니까?')) return;
          var kill = (p.images || []).map(function (im) {
            return SHSPhotos.remove(im.full).then(function () { return SHSPhotos.remove(im.thumb); });
          });
          Promise.all(kill).catch(function () {}).then(function () {
            return db().then(function (c) {
              return c.from('sichal_posts').delete().eq('id', p.id).select('id');
            });
          }).then(function (r) {
            if (r.error) throw r.error;
            if (!(r.data && r.data.length)) throw new Error('지우지 못했습니다. 권한을 확인해 주세요.');
            SHS.logAction('delete', '시찰 게시글 삭제', NAME + ' / ' + p.title);
            openId = null; editId = null;
            reload(function () { drawBoard(box); });
          }).catch(fail);
        });
      });

      var cmtSend = document.getElementById('bd-cmt-send');
      if (cmtSend) {
        var inp = document.getElementById('bd-cmt');
        var send = function () {
          var body = (inp.value || '').trim();
          if (!body) return;
          inp.disabled = true;
          db().then(function (c) {
            return c.from('sichal_post_comments').insert({
              post_id: openId, user_id: user.id, author_name: user.name, body: body
            }).select();
          }).then(function (r) {
            if (r.error) throw r.error;
            inp.value = '';
            reload(function () { drawBoard(box); });
          }).catch(fail).then(function () { inp.disabled = false; });
        };
        cmtSend.addEventListener('click', send);
        inp.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') send(); });
      }
      box.querySelectorAll('button[data-cdel]').forEach(function (b) {
        b.addEventListener('click', function () {
          db().then(function (c) {
            return c.from('sichal_post_comments').delete().eq('id', b.dataset.cdel).select('id');
          }).then(function (r) {
            if (r.error) throw r.error;
            reload(function () { drawBoard(box); });
          }).catch(fail);
        });
      });

      var cancel = document.getElementById('bd-cancel');
      if (cancel) cancel.addEventListener('click', function () { editId = null; drawBoard(box); });

      var save = document.getElementById('bd-save');
      if (!save) return;
      SHS.dropZone(document.getElementById('bd-files'), { what: '사진', accept: 'image' });
      save.addEventListener('click', function () {
        var msg = document.getElementById('bd-msg');
        var title = document.getElementById('bd-title').value.trim();
        if (!title) { msg.className = 'form-msg err'; msg.textContent = '제목을 적어 주세요.'; return; }
        var pinEl = document.getElementById('bd-pin');
        var files = document.getElementById('bd-files').files;
        var old = editId ? posts.filter(function (x) { return String(x.id) === String(editId); })[0] : null;

        save.disabled = true;
        msg.className = 'form-msg';
        msg.textContent = files.length ? '사진을 올리는 중입니다...' : '저장하는 중입니다...';

        putPhotos(files, function (i, n) {
          msg.textContent = '사진을 올리는 중입니다... (' + i + '/' + n + ')';
        }).then(function (ups) {
          var d = {
            sichal: NAME,
            cat: document.getElementById('bd-cat').value,
            title: title,
            body: document.getElementById('bd-body').value.trim() || null,
            link_url: document.getElementById('bd-link').value.trim() || null,
            pinned: pinEl ? !!pinEl.checked : (old ? !!old.pinned : false),
            images: ((old && old.images) || []).concat(ups),
            updated_at: new Date().toISOString()
          };
          return db().then(function (c) {
            if (old) return c.from('sichal_posts').update(d).eq('id', old.id).select();
            d.author_id = user.id;
            d.author_name = user.name;
            return c.from('sichal_posts').insert(d).select();
          });
        }).then(function (r) {
          if (r.error) throw r.error;
          if (!(r.data && r.data.length)) throw new Error('저장하지 못했습니다. 권한을 확인해 주세요.');
          SHS.logAction(old ? 'update' : 'create', '시찰 게시글 ' + (old ? '수정' : '등록'), NAME + ' / ' + title);
          editId = null;
          openId = r.data[0].id;
          reload(function () { drawBoard(box); });
        }).catch(function (x) {
          msg.className = 'form-msg err';
          msg.textContent = '저장하지 못했습니다: ' + ((x && x.message) || x);
        }).then(function () { save.disabled = false; });
      });
    }

    /* ================= 사진첩 ================= */

    function albumList() {
      var by = {};
      photos.forEach(function (p) {
        var k = p.album || '행사 사진';
        if (!by[k]) by[k] = { title: k, taken: p.taken || '', photos: [] };
        by[k].photos.push(p);
        if ((p.taken || '') > by[k].taken) by[k].taken = p.taken || by[k].taken;
      });
      return Object.keys(by).map(function (k) { return by[k]; })
        .sort(function (a, b) { return a.taken < b.taken ? 1 : a.taken > b.taken ? -1 : 0; });
    }
    function albumOf(name) {
      return albumList().filter(function (a) { return a.title === name; })[0];
    }
    function pickedList() {
      return photos.filter(function (p) { return picked[p.id]; });
    }

    function drawPhotos(box) {
      photoEl = box || photoEl;
      var h = '';

      h += '<div class="notice-banner" style="margin-bottom:16px">' +
        '<strong>' + e(NAME) + ' 사진·영상</strong>입니다. 우리 시찰 사진은 행사별 앨범으로, ' +
        '유튜브 영상은 <strong>영상</strong> 칸에 따로 모아 둡니다. ' +
        '사진은 끌어다 놓으면 웹 크기로 줄여 올라갑니다. ' +
        '마음에 드는 사진·영상을 골라 <strong>노회 홈페이지에 게시하기</strong>를 누르시면 ' +
        '노회 갤러리에도 함께 실립니다.</div>';

      if (album && albumOf(album)) h += albumView(albumOf(album));
      else {
        h += videoGrid();
        h += (videos.length ? '<section class="alb-sec"><h2>앨범</h2>' : '<section>') +
          albumGrid() + '</section>';
      }

      if (o.canWrite !== false) h += photoForm();
      box.innerHTML = h;
      bindPhotos(box);
    }

    /* 영상 칸 — 노회 갤러리의 영상 칸과 같은 카드 */
    function videoGrid() {
      if (!videos.length) return '';
      return '<section class="alb-sec" id="rv-sec"><h2>영상</h2><div class="vid-grid">' +
        videos.map(function (v) {
          var id = ytId(v.image_url);
          var pub = !!v.gallery_item_id;
          return '<div class="vid-card">' +
            '<a class="vid-thumb" href="' + e(v.image_url) + '" target="_blank" rel="noopener" ' +
            'data-rvplay="' + v.id + '" aria-label="' + e((v.album || '영상') + ' 보기') + '">' +
            '<img loading="lazy" src="' + e(v.thumb_url || ytThumb(id)) + '" alt="" ' +
            'data-rvfb="' + e(ytThumb(id)) + '">' +
            '<span class="vid-play">&#9654;</span></a>' +
            '<span class="vid-cap"><span class="t">' + e(v.album || '시찰 영상') + '</span>' +
            '<span class="d">' + e(dateText(v.taken)) +
            (v.author_name ? ' · ' + e(v.author_name) : '') + '</span>' +
            '<span class="rv-acts">' +
            (pub ? '<span class="rv-pub">노회 게시</span>' : '') +
            /* 게시 표시(gallery_item_id)를 적을 수 있는 사람만 — 그래야 두 번 실리지 않는다 */
            (!pub && canEdit(v)
              ? '<button type="button" class="btn ghost sm" data-rvpub="' + v.id + '">' +
                '노회 홈페이지에 게시하기</button>'
              : '') +
            (pub && (mine(v) || canManage)
              ? '<button type="button" class="btn ghost sm" data-phunpub="' + v.id + '">노회 게시 취소</button>'
              : '') +
            '</span></span>' +
            (canEdit(v)
              ? '<button type="button" class="vid-thumbbtn" data-rvthumb="' + v.id + '">썸네일 바꾸기</button>' +
                '<button type="button" class="vid-del" data-phdel="' + v.id + '">삭제</button>'
              : '') +
            '</div>';
        }).join('') + '</div></section>';
    }

    function albumGrid() {
      var list = albumList();
      if (!list.length) {
        return '<p class="alb-empty">아직 올린 사진이 없습니다. 아래에서 첫 사진을 올려 보세요.</p>';
      }
      var nPub = photos.filter(function (p) { return p.gallery_item_id; }).length;
      return '<div style="margin-bottom:10px;font-size:0.86rem;color:var(--gray-5)">' +
        '앨범 ' + list.length + '개 · 사진 ' + photos.length + '장' +
        (nPub ? ' · 그중 ' + nPub + '장이 노회 갤러리에 실려 있습니다.' : '') + '</div>' +
        '<div class="alb-grid">' + list.map(function (a) {
          var cover = a.photos[0] || {};
          return '<a class="alb-card" href="#" data-alb="' + e(a.title) + '">' +
            '<img loading="lazy" src="' + e(cover.thumb_url || cover.image_url || '') + '" alt="">' +
            '<span class="alb-cap"><span class="t">' + e(a.title) + '</span>' +
            '<span class="d">' + e(dateText(a.taken)) + ' · 사진 ' + a.photos.length + '장</span></span></a>';
        }).join('') + '</div>';
    }

    function albumView(a) {
      var sel = pickedList();
      var h = '<div class="alb-head" style="display:flex;justify-content:space-between;' +
        'align-items:flex-end;gap:10px;flex-wrap:wrap">' +
        '<div><h2 style="margin:0">' + e(a.title) + '</h2>' +
        '<span class="d">' + e(dateText(a.taken)) + ' · 사진 ' + a.photos.length + '장</span></div>' +
        '<button class="btn ghost sm" id="ph-back">앨범 목록으로</button></div>';

      h += '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px">' +
        '<button class="btn sm" id="ph-pub"' + (sel.length ? '' : ' disabled') + '>' +
        '이 사진을 노회 홈페이지에 게시하기' + (sel.length ? ' (' + sel.length + '장)' : '') + '</button>' +
        '<button class="btn ghost sm" id="ph-selall">이 앨범 모두 고르기</button>' +
        (sel.length ? '<button class="btn ghost sm" id="ph-selnone">고른 것 풀기</button>' : '') +
        '<span style="font-size:0.8rem;color:var(--gray-5)">사진 왼쪽 위 네모를 눌러 고르시면 됩니다.</span></div>';

      if (pubOpen && sel.length) h += publishBox(a, sel);

      h += '<div class="alb-photos">' + a.photos.map(function (p, i) {
        var pub = !!p.gallery_item_id;
        return '<div style="position:relative">' +
          '<img loading="lazy" src="' + e(p.thumb_url || p.image_url) + '" alt="' + e(p.caption || '') + '" ' +
          'data-phi="' + i + '" style="cursor:zoom-in">' +
          '<label style="position:absolute;top:6px;left:6px;background:rgba(255,255,255,0.9);' +
          'border-radius:4px;padding:2px 5px;cursor:pointer">' +
          '<input type="checkbox" class="ph-sel" data-phid="' + p.id + '"' +
          (picked[p.id] ? ' checked' : '') + ' style="width:auto;margin:0"></label>' +
          (pub
            ? '<span style="position:absolute;top:6px;right:6px;background:var(--navy);color:#fff;' +
              'font-size:0.7rem;padding:2px 6px;border-radius:3px">노회 게시</span>'
            : '') +
          (canEdit(p)
            ? '<button class="btn danger sm" data-phdel="' + p.id + '" style="position:absolute;' +
              'bottom:6px;right:6px;padding:2px 7px;font-size:0.72rem">지우기</button>'
            : '') +
          (pub && (mine(p) || canManage)
            ? '<button class="btn ghost sm" data-phunpub="' + p.id + '" style="position:absolute;' +
              'bottom:6px;left:6px;padding:2px 7px;font-size:0.72rem;background:rgba(255,255,255,0.92)">' +
              '노회 게시 취소</button>'
            : '') +
          '</div>';
      }).join('') + '</div>';
      return h;
    }

    function publishBox(a, sel) {
      var cats = galCats.slice();
      if (cats.indexOf(NAME) === -1) cats.unshift(NAME);
      return '<div class="admin-card" id="ph-pubbox" style="margin-bottom:16px">' +
        '<h3 style="margin-top:0">노회 홈페이지에 게시하기 — 사진 ' + sel.length + '장</h3>' +
        '<p style="font-size:0.84rem;color:var(--gray-5);margin:0 0 12px">' +
        '고르신 사진이 노회 갤러리에 그대로 실립니다. 사진을 다시 올리지 않고 같은 사진을 함께 쓰므로 ' +
        '보관 용량이 늘지 않습니다. 실린 뒤에도 이 사진첩에는 그대로 남아 있습니다.</p>' +
        '<div class="inline-form">' +
        '<div class="field"><label>노회 갤러리에 보일 앨범 이름</label>' +
        '<input type="text" id="pb-title" value="' + e(NAME + ' ' + a.title) + '"></div>' +
        '<div class="field" style="flex:0 0 160px"><label>날짜</label>' +
        '<input type="date" id="pb-date" value="' + e((a.taken || today()).slice(0, 10)) + '"></div>' +
        '<div class="field" style="flex:0 0 180px"><label>분류</label><select id="pb-cat">' +
        cats.map(function (k) { return '<option value="' + e(k) + '">' + e(k) + '</option>'; }).join('') +
        '</select></div></div>' +
        '<button class="btn" id="pb-go">노회 갤러리에 올리기</button> ' +
        '<button class="btn ghost" id="pb-cancel">취소</button>' +
        '<div class="form-msg" id="pb-msg"></div></div>';
    }

    function photoForm() {
      var names = albumList().map(function (a) { return a.title; });
      var vid = upKind === 'video';
      return '<div class="admin-card" style="margin-top:22px" id="ph-form">' +
        '<h3 style="margin-top:0">사진 · 유튜브 올리기</h3>' +
        '<div class="tabs sub-tabs" id="ph-kind" style="margin-bottom:14px">' +
        '<button type="button" class="' + (vid ? '' : 'active') + '" data-uk="photo">사진</button>' +
        '<button type="button" class="' + (vid ? 'active' : '') + '" data-uk="video">유튜브 영상</button>' +
        '</div>' +
        videoForm(vid) +
        '<div id="ph-photobox"' + (vid ? ' style="display:none"' : '') + '>' +
        '<div class="inline-form">' +
        '<div class="field"><label>앨범</label><select id="ph-album">' +
        '<option value="">+ 새 앨범 만들기</option>' +
        names.map(function (n) {
          return '<option value="' + e(n) + '"' + (album === n ? ' selected' : '') + '>' + e(n) + '</option>';
        }).join('') + '</select></div>' +
        '<div class="field" id="ph-newbox"><label>새 앨범 이름</label>' +
        '<input type="text" id="ph-new" placeholder="예) 2026년 봄 시찰 헌신예배"></div>' +
        '<div class="field" style="flex:0 0 160px"><label>찍은 날</label>' +
        '<input type="date" id="ph-date" value="' + today() + '"></div>' +
        '</div>' +
        '<div class="field"><label>사진 설명 (선택 · 고른 사진 모두에 함께 붙습니다)</label>' +
        '<input type="text" id="ph-cap" maxlength="120"></div>' +
        '<div class="field"><label>사진 (여러 장 가능)</label>' +
        '<input type="file" id="ph-files" accept="image/*" multiple></div>' +
        '<button class="btn" id="ph-send">올리기</button>' +
        '<div class="form-msg" id="ph-msg"></div></div></div>';
    }

    /* 유튜브 영상 올리기 — 사진 앨범과 따로 영상 칸에 모인다 */
    function videoForm(vid) {
      return '<div id="rv-form"' + (vid ? '' : ' style="display:none"') + '>' +
        '<div class="field"><label>유튜브 주소</label>' +
        '<input type="url" id="rv-link" placeholder="유튜브 영상 주소를 붙여 넣으세요"></div>' +
        '<div class="inline-form">' +
        '<div class="field"><label>영상 제목</label>' +
        '<input type="text" id="rv-title" maxlength="120" placeholder="영상 제목을 적으세요"></div>' +
        '<div class="field" style="flex:0 0 160px"><label>날짜</label>' +
        '<input type="date" id="rv-date" value="' + today() + '"></div>' +
        '</div>' +
        '<div class="field"><label>영상 설명 (선택)</label>' +
        '<input type="text" id="rv-cap" maxlength="200"></div>' +
        '<div class="field"><label>썸네일 (선택)</label>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<button type="button" class="btn ghost sm" id="rv-tpick">썸네일 그림 고르기</button>' +
        '<button type="button" class="btn ghost sm" id="rv-tclear"' + (vtFile ? '' : ' style="display:none"') +
        '>유튜브 기본 그림으로</button>' +
        '<input type="file" id="rv-tfile" accept="image/*" style="display:none"></div>' +
        '<p style="font-size:0.82rem;color:var(--gray-5);margin:6px 0 0">' +
        '고르지 않으면 유튜브 영상의 기본 그림을 씁니다. 가로로 넓은(16:9) 그림이 잘 맞습니다.</p></div>' +
        '<div id="rv-prev" style="display:none;margin-bottom:14px">' +
        '<img id="rv-thumb" alt="썸네일 미리보기" style="width:100%;max-width:320px;aspect-ratio:16/9;' +
        'object-fit:cover;border-radius:10px;display:block"></div>' +
        '<button type="button" class="btn" id="rv-send">영상 올리기</button>' +
        '<div class="form-msg" id="rv-msg"></div></div>';
    }

    function bindPhotos(box) {
      box.querySelectorAll('a[data-alb]').forEach(function (a) {
        a.addEventListener('click', function (ev) {
          ev.preventDefault();
          album = a.dataset.alb; pubOpen = false;
          drawPhotos(box);
        });
      });
      var back = document.getElementById('ph-back');
      if (back) back.addEventListener('click', function () {
        album = null; picked = {}; pubOpen = false; drawPhotos(box);
      });

      var cur = album ? albumOf(album) : null;
      box.querySelectorAll('img[data-phi]').forEach(function (im) {
        im.addEventListener('click', function () {
          if (!cur) return;
          openLb(cur.photos, +im.dataset.phi);
        });
      });
      box.querySelectorAll('.ph-sel').forEach(function (cb) {
        cb.addEventListener('change', function () {
          if (cb.checked) picked[cb.dataset.phid] = true;
          else delete picked[cb.dataset.phid];
          drawPhotos(box);
        });
      });
      var selall = document.getElementById('ph-selall');
      if (selall) selall.addEventListener('click', function () {
        if (cur) cur.photos.forEach(function (p) { picked[p.id] = true; });
        drawPhotos(box);
      });
      var selnone = document.getElementById('ph-selnone');
      if (selnone) selnone.addEventListener('click', function () {
        picked = {}; pubOpen = false; drawPhotos(box);
      });
      var pub = document.getElementById('ph-pub');
      if (pub) pub.addEventListener('click', function () {
        pubOpen = true; drawPhotos(box);
        var b = document.getElementById('ph-pubbox');
        if (b) b.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      var pbCancel = document.getElementById('pb-cancel');
      if (pbCancel) pbCancel.addEventListener('click', function () { pubOpen = false; drawPhotos(box); });
      var pbGo = document.getElementById('pb-go');
      if (pbGo) pbGo.addEventListener('click', function () { publish(box); });

      box.querySelectorAll('button[data-phdel]').forEach(function (b) {
        b.addEventListener('click', function () { removePhoto(b.dataset.phdel, box); });
      });
      box.querySelectorAll('button[data-phunpub]').forEach(function (b) {
        b.addEventListener('click', function () { unpublish(b.dataset.phunpub, box); });
      });

      /* ----- 영상 칸 ----- */
      box.querySelectorAll('a[data-rvplay]').forEach(function (a) {
        a.addEventListener('click', function (ev) {
          var v = rowOf(a.dataset.rvplay);
          if (!v) return;
          ev.preventDefault();
          openPlayer(v);
        });
      });
      /* 따로 올린 썸네일이 사라졌으면 유튜브 기본 그림으로 */
      box.querySelectorAll('img[data-rvfb]').forEach(function (im) {
        im.addEventListener('error', function () {
          if (im.src !== im.dataset.rvfb) im.src = im.dataset.rvfb;
        }, { once: true });
      });
      box.querySelectorAll('button[data-rvthumb]').forEach(function (b) {
        b.addEventListener('click', function () {
          vtTarget = rowOf(b.dataset.rvthumb);
          if (!vtTarget) return;
          thumbPicker().click();
        });
      });
      box.querySelectorAll('button[data-rvpub]').forEach(function (b) {
        b.addEventListener('click', function () { publishVideo(rowOf(b.dataset.rvpub), b, box); });
      });

      bindKind(box);
      bindVideoForm(box);

      var send = document.getElementById('ph-send');
      if (!send) return;
      SHS.dropZone(document.getElementById('ph-files'), { what: '사진', accept: 'image' });
      var sel = document.getElementById('ph-album');
      var newBox = document.getElementById('ph-newbox');
      function syncAlbum() { newBox.style.display = sel.value ? 'none' : ''; }
      sel.addEventListener('change', syncAlbum);
      syncAlbum();

      send.addEventListener('click', function () {
        var msg = document.getElementById('ph-msg');
        var files = document.getElementById('ph-files').files;
        if (!files.length) {
          msg.className = 'form-msg err'; msg.textContent = '올릴 사진을 골라 주세요.'; return;
        }
        var name = sel.value || document.getElementById('ph-new').value.trim();
        if (!name) {
          msg.className = 'form-msg err'; msg.textContent = '앨범 이름을 적어 주세요.'; return;
        }
        var taken = document.getElementById('ph-date').value || today();
        var cap = document.getElementById('ph-cap').value.trim() || null;
        var a = albumOf(name);
        var sort = 0;
        if (a) a.photos.forEach(function (p) { if ((p.sort || 0) > sort) sort = p.sort || 0; });

        send.disabled = true;
        msg.className = 'form-msg';
        msg.textContent = '사진을 올리는 중입니다...';
        putPhotos(files, function (i, n) {
          msg.textContent = '사진을 올리는 중입니다... (' + i + '/' + n + ')';
        }).then(function (ups) {
          var rows = ups.map(function (u, i) {
            return {
              sichal: NAME, album: name, taken: taken, caption: cap,
              image_url: u.full, thumb_url: u.thumb, sort: sort + i + 1,
              author_id: user.id, author_name: user.name
            };
          });
          return db().then(function (c) { return c.from('sichal_photos').insert(rows).select(); });
        }).then(function (r) {
          if (r.error) throw r.error;
          SHS.logAction('create', '시찰 사진 등록', NAME + ' / ' + name + ' ' + files.length + '장');
          album = name;
          reload(function () { drawPhotos(box); });
        }).catch(function (x) {
          msg.className = 'form-msg err';
          msg.textContent = '올리지 못했습니다: ' + ((x && x.message) || x);
        }).then(function () { send.disabled = false; });
      });
    }

    /* 사진첩 줄 하나 (사진이든 영상이든) */
    function rowOf(id) {
      return photos.concat(videos).filter(function (x) { return String(x.id) === String(id); })[0];
    }

    /* 올리기 칸의 사진 / 유튜브 영상 — 다시 그리지 않고 보이기만 바꾼다 (적던 내용이 남는다) */
    function bindKind(box) {
      var bar = box.querySelector('#ph-kind');
      if (!bar) return;
      bar.querySelectorAll('button[data-uk]').forEach(function (b) {
        b.addEventListener('click', function () {
          upKind = b.dataset.uk;
          bar.querySelectorAll('button').forEach(function (x) { x.classList.toggle('active', x === b); });
          var vid = upKind === 'video';
          box.querySelector('#rv-form').style.display = vid ? '' : 'none';
          box.querySelector('#ph-photobox').style.display = vid ? 'none' : '';
        });
      });
    }

    /* ----- 유튜브 영상 올리기 ----- */
    function bindVideoForm(box) {
      var go = box.querySelector('#rv-send');
      if (!go) return;
      var link = box.querySelector('#rv-link');
      var prev = box.querySelector('#rv-prev');
      var im = box.querySelector('#rv-thumb');
      var clr = box.querySelector('#rv-tclear');
      var tfile = box.querySelector('#rv-tfile');
      var objUrl = null;
      /* 고른 썸네일이 있으면 그것을, 없으면 유튜브 기본 그림을 미리 보여 준다 */
      function preview() {
        var id = ytId(link.value);
        clr.style.display = vtFile ? '' : 'none';
        if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null; }
        if (vtFile) { objUrl = URL.createObjectURL(vtFile); im.src = objUrl; prev.style.display = ''; }
        else if (id) { im.src = ytThumb(id); prev.style.display = ''; }
        else prev.style.display = 'none';
      }
      preview();
      link.addEventListener('input', preview);
      box.querySelector('#rv-tpick').addEventListener('click', function () { tfile.click(); });
      tfile.addEventListener('change', function () {
        var f = tfile.files && tfile.files[0];
        tfile.value = '';
        if (f && f.type.indexOf('image/') === 0) { vtFile = f; preview(); }
      });
      clr.addEventListener('click', function () { vtFile = null; preview(); });

      go.addEventListener('click', function () {
        if (go.disabled) return;
        var msg = box.querySelector('#rv-msg');
        var id = ytId(link.value);
        if (!id) {
          msg.className = 'form-msg err'; msg.textContent = '유튜브 주소를 확인해 주세요.'; return;
        }
        var title = box.querySelector('#rv-title').value.trim() || '시찰 영상';
        var taken = box.querySelector('#rv-date').value || today();
        var cap = box.querySelector('#rv-cap').value.trim() || null;
        var made = null;   /* 새로 올린 썸네일 — 저장하지 못하면 도로 지운다 */

        go.disabled = true;
        go.textContent = '올리는 중...';
        msg.className = 'form-msg';
        msg.textContent = '올리는 중입니다...';
        (vtFile
          ? putThumb(vtFile).then(function (u) { made = u; return u; })
          : Promise.resolve(ytThumb(id))
        ).then(function (thumb) {
          return db().then(function (c) {
            return c.from('sichal_photos').insert({
              sichal: NAME, album: title, taken: taken, caption: cap,
              image_url: 'https://www.youtube.com/watch?v=' + id, thumb_url: thumb,
              sort: 0, author_id: user.id, author_name: user.name
            }).select();
          });
        }).then(function (r) {
          if (r.error) throw r.error;
          if (!(r.data && r.data.length)) throw new Error('권한을 확인해 주세요.');
          SHS.logAction('create', '시찰 영상 등록', NAME + ' / ' + title);
          vtFile = null; album = null;
          reload(function () {
            drawPhotos(box);
            var s = document.getElementById('rv-sec');
            if (s) s.scrollIntoView({ behavior: 'smooth', block: 'start' });
          });
        }).catch(function (x) {
          if (made) SHSPhotos.remove(made);
          msg.className = 'form-msg err';
          msg.textContent = '올리지 못했습니다: ' + ((x && x.message) || x);
          go.disabled = false;
          go.textContent = '영상 올리기';
        });
      });
    }

    /* ----- 이미 올린 영상의 썸네일 바꾸기 (올린 사람 · 시찰 임원) ----- */
    var thumbBusy = false;
    function thumbPicker() {
      if (vtEdit) return vtEdit;
      vtEdit = document.createElement('input');
      vtEdit.type = 'file';
      vtEdit.accept = 'image/*';
      vtEdit.style.display = 'none';
      document.body.appendChild(vtEdit);
      vtEdit.addEventListener('change', function () {
        var f = vtEdit.files && vtEdit.files[0];
        vtEdit.value = '';
        if (f && f.type.indexOf('image/') === 0) changeThumb(vtTarget, f);
      });
      return vtEdit;
    }
    function changeThumb(v, file) {
      if (thumbBusy || !v) return;
      thumbBusy = true;
      var btn = photoEl && photoEl.querySelector('button[data-rvthumb="' + v.id + '"]');
      if (btn) { btn.disabled = true; btn.textContent = '올리는 중...'; }
      var old = v.thumb_url;
      var made = null;
      putThumb(file).then(function (url) {
        made = url;
        return db().then(function (c) {
          return c.from('sichal_photos').update({ thumb_url: url }).eq('id', v.id).select('id').then(function (r) {
            if (r.error) throw r.error;
            if (!(r.data && r.data.length)) throw new Error('올린 분이나 시찰 임원만 바꿀 수 있습니다.');
            made = null;          /* 이제 이 그림을 쓰고 있다 */
            if (!v.gallery_item_id) return true;
            /* 노회 갤러리에 실린 영상이면 그쪽 겉그림도 함께 바꾼다 */
            return c.from('gallery_items').update({ image_url: url, thumb_url: url })
              .eq('id', v.gallery_item_id).select('id')
              .then(function (g) { return !g.error && !!(g.data && g.data.length); }, function () { return false; });
          });
        });
      }).then(function (free) {
        /* 노회 갤러리가 아직 옛 그림을 쓰면 지우지 않는다 (유튜브 기본 그림이면 아무 일도 없다) */
        if (free) SHSPhotos.remove(old);
        SHS.logAction('update', '시찰 영상 썸네일', NAME + ' / ' + (v.album || ''));
        reload(function () { drawPhotos(photoEl); });
      }).catch(function (x) {
        if (made) SHSPhotos.remove(made);
        if (btn) { btn.disabled = false; btn.textContent = '썸네일 바꾸기'; }
        alert('썸네일을 바꾸지 못했습니다: ' + ((x && x.message) || x));
      }).then(function () { thumbBusy = false; });
    }

    /* ----- 영상을 노회 갤러리 영상 칸에도 싣는다 ----- */
    function publishVideo(v, btn, box) {
      if (!v || v.gallery_item_id || btn.disabled) return;
      var title = v.album || '시찰 영상';
      if (!confirm('「' + title + '」 영상을 노회 갤러리 영상 칸에도 올립니다. ' +
                   '시찰 사진첩에도 그대로 남습니다. 계속하시겠습니까?')) return;
      var id = ytId(v.image_url);
      var thumb = v.thumb_url || ytThumb(id);
      btn.disabled = true;
      btn.textContent = '올리는 중...';
      db().then(function (c) {
        return c.from('gallery_items').insert({
          title: title, taken: v.taken || today(), category: '영상',
          caption: v.caption || null,
          link_url: 'https://www.youtube.com/watch?v=' + id,
          image_url: thumb, thumb_url: thumb, sort: 0,
          author_id: user.id, author_name: user.name
        }).select();
      }).then(function (r) {
        if (r.error) throw r.error;
        var g = r.data && r.data[0];
        if (!g) throw new Error('권한을 확인해 주세요.');
        return db().then(function (c) {
          return c.from('sichal_photos').update({
            gallery_item_id: g.id, published_at: new Date().toISOString(), published_by: user.name
          }).eq('id', v.id);
        });
      }).then(function () {
        SHS.logAction('create', '시찰 영상 노회 게시', NAME + ' / ' + title);
        reload(function () {
          drawPhotos(box);
          alert('「' + title + '」 영상을 노회 갤러리에 올렸습니다.\n갤러리 화면의 영상 칸에서 보실 수 있습니다.');
        });
      }).catch(function (x) {
        btn.disabled = false;
        btn.textContent = '노회 홈페이지에 게시하기';
        fail(x);
      });
    }

    /* 고른 사진을 노회 갤러리에 그대로 싣는다 (사진은 다시 올리지 않는다) */
    function publish(box) {
      var sel = pickedList();
      if (!sel.length) return;
      var msg = document.getElementById('pb-msg');
      var go = document.getElementById('pb-go');
      var title = document.getElementById('pb-title').value.trim();
      if (!title) { msg.className = 'form-msg err'; msg.textContent = '앨범 이름을 적어 주세요.'; return; }
      var taken = document.getElementById('pb-date').value || today();
      var cat = document.getElementById('pb-cat').value;

      go.disabled = true;
      msg.className = 'form-msg';
      msg.textContent = '노회 갤러리에 올리는 중입니다...';

      var fresh = sel.filter(function (p) { return !p.gallery_item_id; });
      if (!fresh.length) {
        msg.className = 'form-msg err';
        msg.textContent = '고르신 사진은 이미 노회 갤러리에 실려 있습니다.';
        go.disabled = false;
        return;
      }

      db().then(function (c) {
        return c.from('gallery_items').insert(fresh.map(function (p, i) {
          return {
            title: title, taken: taken, category: cat,
            caption: p.caption || null,
            image_url: p.image_url, thumb_url: p.thumb_url,
            sort: i + 1, author_id: user.id, author_name: user.name
          };
        })).select();
      }).then(function (r) {
        if (r.error) throw r.error;
        var made = r.data || [];
        if (made.length !== fresh.length) throw new Error('일부 사진을 올리지 못했습니다.');
        var now = new Date().toISOString();
        return db().then(function (c) {
          return Promise.all(fresh.map(function (p, i) {
            return c.from('sichal_photos').update({
              gallery_item_id: made[i].id, published_at: now, published_by: user.name
            }).eq('id', p.id);
          }));
        });
      }).then(function () {
        SHS.logAction('create', '시찰 사진 노회 게시', NAME + ' / ' + title + ' ' + fresh.length + '장');
        picked = {}; pubOpen = false;
        reload(function () {
          drawPhotos(box);
          alert('사진 ' + fresh.length + '장을 노회 갤러리에 올렸습니다.\n갤러리 화면의 「' + title + '」 앨범에서 보실 수 있습니다.');
        });
      }).catch(function (x) {
        msg.className = 'form-msg err';
        msg.textContent = '올리지 못했습니다: ' + ((x && x.message) || x);
        go.disabled = false;
      });
    }

    function unpublish(id, box) {
      var p = rowOf(id);
      if (!p || !p.gallery_item_id) return;
      var what = isVid(p) ? '영상' : '사진';
      if (!confirm('이 ' + what + '을 노회 갤러리에서 내립니다. 시찰 사진첩에는 그대로 남습니다. 계속하시겠습니까?')) return;
      db().then(function (c) {
        return c.from('gallery_items').delete().eq('id', p.gallery_item_id).select('id');
      }).then(function (r) {
        if (r.error) throw r.error;
        if (!(r.data && r.data.length)) throw new Error('내리지 못했습니다. 올린 분이나 관리자만 내릴 수 있습니다.');
        return db().then(function (c) {
          return c.from('sichal_photos').update({
            gallery_item_id: null, published_at: null, published_by: null
          }).eq('id', p.id);
        });
      }).then(function () {
        SHS.logAction('delete', '시찰 ' + what + ' 노회 게시 취소', NAME + ' / ' + (p.album || ''));
        reload(function () { drawPhotos(box); });
      }).catch(fail);
    }

    function removePhoto(id, box) {
      var p = rowOf(id);
      if (!p) return;
      var what = isVid(p) ? '영상' : '사진';
      var warn = p.gallery_item_id
        ? '이 ' + what + '은 노회 갤러리에도 실려 있습니다. 지우면 노회 갤러리에서도 함께 사라집니다.\n\n계속하시겠습니까?'
        : '이 ' + what + '을 지웁니다. 되돌릴 수 없습니다. 계속하시겠습니까?';
      if (!confirm(warn)) return;

      var freed = true;   /* 노회 갤러리가 더는 이 파일을 쓰지 않는가 */
      db().then(function (c) {
        var pre = p.gallery_item_id
          ? c.from('gallery_items').delete().eq('id', p.gallery_item_id).select('id').then(function (g) {
              freed = !g.error && !!(g.data && g.data.length);
            }, function () { freed = false; })
          : Promise.resolve();
        return pre.then(function () {
          return c.from('sichal_photos').delete().eq('id', p.id).select('id');
        });
      }).then(function (r) {
        if (r.error) throw r.error;
        if (!(r.data && r.data.length)) throw new Error('지우지 못했습니다. 권한을 확인해 주세요.');
        /* 노회 갤러리에서 내리지 못했으면 그쪽에서 계속 보이도록 파일은 남겨 둔다.
         * 영상의 유튜브 주소·기본 그림은 보관소 파일이 아니므로 아무 일도 없다. */
        if (!freed) return;
        return SHSPhotos.remove(p.image_url)
          .then(function () { return SHSPhotos.remove(p.thumb_url); })
          .catch(function () {});
      }).then(function () {
        SHS.logAction('delete', '시찰 ' + what + ' 삭제', NAME + ' / ' + (p.album || ''));
        delete picked[p.id];
        reload(function () { drawPhotos(box); });
      }).catch(fail);
    }

    return {
      load: load,
      postCount: function () { return posts.length; },
      photoCount: function () { return photos.length + videos.length; },
      drawBoard: drawBoard,
      drawPhotos: drawPhotos
    };
  }

  return { create: create, ytId: ytId, ytThumb: ytThumb, shrink: shrink };
})();

/* 사진 보관소 연결
 *
 * 사진은 Cloudflare R2에, 글·명단·기록은 Supabase에 나누어 보관한다.
 * 사진을 내보내는 데 요금이 붙지 않으므로 갤러리가 커져도 부담이 없다.
 *
 * 아직 보관소 주소가 설정되지 않았거나 보관소에 문제가 있으면
 * 예전처럼 Supabase에 올린다. 그래서 홈페이지가 멈추는 일은 없다.
 * 이미 올라가 있는 사진의 주소는 그대로 두므로 예전 사진도 계속 보인다.
 */
var SHSPhotos = (function () {

  function base() {
    var b = (window.SHS_PHOTOS && SHS_PHOTOS.base) || '';
    return b.replace(/\/+$/, '');
  }

  function enabled() { return !!base(); }

  function urlOf(key) { return base() + '/o/' + key; }

  /* 로그인 증표를 얻는다. 보관소는 이 증표로 노회 회원인지 확인한다. */
  function token() {
    if (!(window.SHSCloud && SHSCloud.enabled())) return Promise.resolve(null);
    return SHSCloud.init().then(function (c) {
      if (!c) return null;
      return c.auth.getSession().then(function (r) {
        return (r && r.data && r.data.session && r.data.session.access_token) || null;
      });
    }).catch(function () { return null; });
  }

  /* 사진 한 장 올리기. 성공하면 보이는 주소를 돌려준다. */
  function upload(blob, key) {
    if (!enabled()) return Promise.reject(new Error('사진 보관소가 설정되지 않았습니다.'));
    return token().then(function (t) {
      if (!t) throw new Error('로그인이 확인되지 않았습니다.');
      return fetch(urlOf(key), {
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer ' + t,
          'Content-Type': blob.type || 'image/jpeg'
        },
        body: blob
      });
    }).then(function (r) {
      if (r.ok) return urlOf(key);
      return r.json().catch(function () { return {}; }).then(function (j) {
        throw new Error(j.error || ('사진을 올리지 못했습니다. (' + r.status + ')'));
      });
    });
  }

  /* 사진 지우기. 우리 보관소의 사진이 아니면 아무 일도 하지 않는다. */
  function remove(photoUrl) {
    if (!enabled() || !photoUrl || photoUrl.indexOf(base() + '/o/') !== 0) {
      return Promise.resolve(false);
    }
    return token().then(function (t) {
      if (!t) return false;
      return fetch(photoUrl, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + t }
      }).then(function (r) { return r.ok; });
    }).catch(function () { return false; });
  }

  /* 겹치지 않는 사진 이름을 만든다 */
  function newKey(folder, ext) {
    var t = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    var r = Math.floor(Math.random() * 1e6);
    return folder + '/' + t + '-' + r + '.' + (ext || 'jpg');
  }

  /* 큰 사진과 작은 사진을 한 쌍으로 올리고 두 주소를 돌려준다.
   * 보관소가 준비되어 있으면 R2에, 아니면 예전처럼 Supabase에 올린다. */
  function putPair(fullBlob, thumbBlob) {
    if (enabled()) {
      var kf = newKey('full');
      var kt = newKey('thumb');
      return upload(fullBlob, kf).then(function (u1) {
        return upload(thumbBlob, kt).then(function (u2) {
          return { full: u1, thumb: u2 };
        });
      });
    }
    var base = Date.now() + '-' + Math.floor(Math.random() * 1e6);
    return SHSCloud.init().then(function (c) {
      return c.storage.from('gallery')
        .upload('full/' + base + '.jpg', fullBlob, { contentType: 'image/jpeg' })
        .then(function (r1) {
          if (r1.error) throw r1.error;
          return c.storage.from('gallery')
            .upload('thumb/' + base + '.jpg', thumbBlob, { contentType: 'image/jpeg' });
        })
        .then(function (r2) {
          if (r2.error) throw r2.error;
          return {
            full: c.storage.from('gallery').getPublicUrl('full/' + base + '.jpg').data.publicUrl,
            thumb: c.storage.from('gallery').getPublicUrl('thumb/' + base + '.jpg').data.publicUrl
          };
        });
    });
  }

  /* 정회원 전용 문서 내려받기.
   * 보관소가 로그인 증표를 확인한 뒤에만 파일을 내어 주므로,
   * 주소를 그대로 눌러서는 열리지 않는다. */
  function isDocUrl(u) {
    return !!u && enabled() && u.indexOf(base() + '/o/docs/') === 0;
  }

  function download(docUrl, fileName) {
    if (!isDocUrl(docUrl)) return Promise.reject(new Error('내려받을 수 있는 자료가 아닙니다.'));
    return token().then(function (t) {
      if (!t) throw new Error('로그인이 확인되지 않았습니다.');
      return fetch(docUrl, { headers: { 'Authorization': 'Bearer ' + t } });
    }).then(function (r) {
      if (!r.ok) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          throw new Error(j.error || ('내려받지 못했습니다. (' + r.status + ')'));
        });
      }
      return r.blob();
    }).then(function (blob) {
      var a = document.createElement('a');
      var u = URL.createObjectURL(blob);
      a.href = u;
      a.download = fileName || docUrl.split('/').pop();
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(u); }, 4000);
      return true;
    });
  }

  return {
    enabled: enabled,
    upload: upload,
    putPair: putPair,
    isDocUrl: isDocUrl,
    download: download,
    remove: remove,
    urlOf: urlOf,
    newKey: newKey
  };
})();

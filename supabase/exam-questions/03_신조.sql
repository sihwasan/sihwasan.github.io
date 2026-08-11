-- =====================================================================
--  고시 문제 은행 3/8 : 신조 (40문항)
--  출처 : 「시화산노회 고시부 목사장로 고시가이드」 예상 문제 은행
--  * 이 과목만 다시 넣습니다. 여러 번 실행해도 문제가 늘어나지 않습니다.
-- =====================================================================

delete from public.exam_questions where subject = '신조';

insert into public.exam_questions (subject, question, options, answer) values ('신조', '대한예수교장로회 합동교단 12신조에 따르면, 신‧구약 성경은 무엇에 대하여 정확무오(正確無誤)한 유일(唯一)의 법칙입니까?', '["교회의 행정과 재정", "신앙과 본분(本分)", "개인의 감정과 체험", "세상의 역사와 과학"]'::jsonb, 1);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '12신조에서 성경을 ''하나님의 말씀''이라고 고백하는 것은 성경의 어떤 특성을 강조합니까?', '["보존성", "문학성", "역사성", "영감성"]'::jsonb, 3);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '성경이 ''유일(唯一)의 법칙''이라는 것은 무엇을 의미합니까?', '["성경 외 다른 종교 경전은 인정하지 않는다.", "성경은 다른 어떤 책보다 우수하다.", "신앙과 본분에 있어서 성경만이 절대적인 최종 권위를 가진다.", "성경만이 세상의 모든 문제를 해결할 수 있다."]'::jsonb, 2);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '''정확무오(正確無誤)''하다는 성경의 속성에 대한 설명으로 옳은 것은?', '["성경에는 역사적, 과학적 오류가 전혀 없다.", "성경은 신앙과 구원에 필요한 모든 진리에 있어서 오류가 없다.", "성경은 인간의 모든 궁금증을 해결해 준다.", "성경은 모든 번역본에서 완벽하게 오류가 없다."]'::jsonb, 1);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '12신조에 따르면, 경배할 대상은 몇 분이십니까?', '["세 분", "한 분", "모든 신", "두 분"]'::jsonb, 1);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '하나님의 본체에 계신 세 위는 누구이십니까?', '["목사, 장로, 집사", "성부, 성자, 성령", "천사, 사람, 영", "창조주, 구속주, 심판주"]'::jsonb, 1);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '12신조에 따르면, 이 세 위는 한 분의 하나님이시며, 무엇이 동등하시다고 고백합니까?', '["본체와 영광", "권능과 영광", "거주지와 역할", "나이와 지위"]'::jsonb, 1);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '''본체는 하나요, 권능과 영광이 동등하시다''는 고백을 통해 알 수 있는 삼위일체 하나님의 관계는?', '["각 위가 독립적으로 사역한다.", "성부만 모든 권능을 소유한다.", "동등하며 본질적으로 하나이다.", "위계적이고 서열적이다."]'::jsonb, 2);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '하나님께서 모든 유형물과 무형물을 창조하신 방법은 무엇입니까?', '["오랜 시간에 걸쳐 점진적으로 만드셨다.", "물질로부터 진화시켰다.", "권능의 말씀으로 창조하셨다.", "천사들의 도움을 받았다."]'::jsonb, 2);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '12신조에 따르면, 하나님은 만유를 자기 뜻의 계획대로 행하시는데, 그 목적은 무엇입니까?', '["죄를 드러내기 위해서만", "자연의 질서를 유지하기 위해서만", "인간의 행복을 위해서만", "자신의 착하시고 지혜롭고 거룩하신 목적을 성취하도록"]'::jsonb, 3);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '다음 중 하나님께서 ''결코 죄를 내신 이는 아니시니''라는 고백이 가지는 의미는?', '["하나님은 죄를 막을 수 없으셨다.", "하나님은 죄를 직접 창조하지 않으셨음을 의미한다.", "죄는 인간의 책임이 아니다.", "죄는 하나님의 창조와 무관하다."]'::jsonb, 1);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '하나님께서 창조하신 모든 것을 ''보존하시고 주장하시나''라는 것은 하나님의 어떤 속성을 강조합니까?', '["섭리", "전지성", "초월성", "전능성"]'::jsonb, 0);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '사람에게 ''생물(生物)을 주관하게 하셨으니''라는 것은 인간에게 주어진 어떤 역할입니까?', '["창조 세계를 관리하고 다스리는 역할", "창조 세계를 파괴하는 역할", "자연에 종속되는 역할", "죄를 짓게 하는 역할"]'::jsonb, 0);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '인간의 시조가 시험을 받아 하나님께 범죄한 것은 무엇 때문입니까?', '["하나님의 강제 때문", "자유능(自由能)이 없었기 때문", "선악간 택할 자유능(自由能)이 있었음에도 불구하고", "악마의 힘에 완전히 지배당했기 때문"]'::jsonb, 2);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '아담의 범죄에 모든 인종들이 동참하여 타락하게 된 방식은 무엇입니까?', '["보통 생육법(生育法)에 의하여 출생함으로써", "강제적인 명령에 의해서", "개인의 선택에 의해서만", "교육을 통해 전염됨으로써"]'::jsonb, 0);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '''원죄(原罪)와 및 부패한 성품'' 외에 인간이 짓는 죄는 무엇입니까?', '["영적인 죄", "무지에서 오는 죄", "무의식적인 죄", "일부러 짓는 죄"]'::jsonb, 3);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '모든 사람이 금세와 내세에 하나님의 공평한 진노와 형벌을 받는 것이 마땅하다는 고백은 무엇을 강조합니까?', '["하나님의 공의와 죄의 결과", "인간의 구원", "하나님의 자비", "인간의 자유 의지"]'::jsonb, 0);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '인류를 구원하시고 영생을 주고자 하신 하나님의 사랑은 무엇이라고 고백합니까?', '["제한된 사랑", "조건적인 사랑", "일시적인 사랑", "무한하신 사랑"]'::jsonb, 3);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '구원을 얻을 수 있는 유일한 통로는 누구입니까?', '["목사", "주 예수 그리스도", "선지자", "천사"]'::jsonb, 1);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '예수 그리스도께서 동정녀 마리아에게 나셨으되, 어떤 특징이 있으십니까?', '["인간적인 결함이 있으시다.", "죄가 없으신 분이시다.", "영으로만 오셨다.", "다른 사람들과 똑같이 죄를 가지고 나셨다."]'::jsonb, 1);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '예수 그리스도께서 죽은 자 가운데서 부활하신 것은 십자가에 못 박혀 죽으신 지 며칠 만입니까?', '["하루", "이틀", "삼 일", "나흘"]'::jsonb, 2);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '성부와 성자로부터 오신 성령께서 인생으로 구원에 참여하게 하시는 주된 역할은 무엇입니까?', '["세상을 심판하게 하심", "물질적 복을 받게 하심", "교회를 확장하게 하심", "죄와 비참을 깨닫게 하심"]'::jsonb, 3);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '성령께서 사람의 마음을 밝혀 누구를 알게 하십니까?', '["그리스도", "천사의 존재", "인간의 본성", "세상의 지식"]'::jsonb, 0);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '성령께서 사람의 의지를 새롭게 하시고 권능을 주어 복음에 값없이 주마 한 누구를 받게 하십니까?', '["영적인 경험", "예수 그리스도", "선지자", "목사"]'::jsonb, 1);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '성령께서 역사하여 사람 안에 맺게 하시는 것은 무엇입니까?', '["모든 의의 열매", "세상의 명예", "물질적인 부", "영원한 생명"]'::jsonb, 0);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '하나님께서 세상을 창조하시기 전에 그리스도 안에서 누구를 택하셨습니까?', '["모든 인류", "교회의 직분자들", "자기 백성", "특정 민족"]'::jsonb, 2);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '하나님께서 자기 백성을 미리 작정하사 누구로 말미암아 자기의 아들을 삼으셨습니까?', '["예수 그리스도", "선한 행위", "인간의 노력", "종교적 의식"]'::jsonb, 0);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '세상 모든 사람에게 온전한 구원을 값없이 주시려고 명하시는 것은 무엇입니까?', '["선한 행위를 많이 쌓는 것", "교회에 많은 헌금을 하는 것", "종교적인 고행을 하는 것", "죄를 회개하고 주 예수 그리스도를 구주로 믿고 의지하며 복종하고 겸손하게 행하는 것"]'::jsonb, 3);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '성령께서 은혜의 직분을 행하실 때 은혜 베푸시는 방도는 특별히 무엇입니까?', '["기적과 이적", "금식과 고행", "성경 말씀과 성례와 기도", "개인적인 계시와 꿈"]'::jsonb, 2);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '세례가 의미하는 바 중 하나는 무엇입니까?', '["육체적인 정결함", "그리스도와 연합하는 표적과 인(印)침", "교회 직분 임명", "죄를 지울 수 있는 능력"]'::jsonb, 1);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '주의 성찬은 무엇을 기념하여 떡과 잔에 참여하는 것입니까?', '["그리스도의 탄생", "그리스도의 재림", "그리스도의 죽으심", "그리스도의 승천"]'::jsonb, 2);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '성례의 유익이 성례의 본덕이나 베푸는 자의 덕으로 말미암는 것이 아니라, 다만 무엇으로 말미암는다고 고백합니까?', '["성례를 받는 자의 공로", "교인들의 열심", "교회의 전통", "그리스도의 복 주심과 믿음으로써 성례를 받는 자 가운데 계신 성령의 행하심"]'::jsonb, 3);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '모든 신자의 본분 중 하나는 무엇입니까?', '["교회의 재정만을 책임지는 것", "입교(入敎)하여 서로 교제하는 것", "자신의 이익만을 추구하는 것", "세상의 모든 법률을 무시하는 것"]'::jsonb, 1);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '신자는 그리스도의 성례 외에 무엇을 지켜야 합니까?', '["미신적인 행위", "세상의 유행", "그 밖의 법례(法例)", "개인적인 욕망"]'::jsonb, 2);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '신자가 주일을 거룩하게 지키는 방법 중 하나는?', '["주일에 개인적인 쾌락만을 추구하는 것", "주일에만 열심히 일하는 것", "주일에 교회에 참석하지 않는 것", "주를 경배하기 위하여 함께 모여 주의 말씀으로 강도(講道)함을 자세히 듣는 것"]'::jsonb, 3);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '신자가 그리스도의 마음과 같은 심사(心思)를 서로 표현하고, 또한 일반 인류에게도 그와 같이 해야 하는 것은 무엇을 강조합니까?', '["개인적인 은둔 생활", "사랑과 섬김", "특권 의식", "세상과의 단절"]'::jsonb, 1);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '죽은 자는 언제 부활함을 받는다고 고백합니까?', '["그리스도의 재림 시", "천국에서", "끝날에", "각자의 죽음 직후"]'::jsonb, 2);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '부활한 자들이 심판을 받는 보좌는 누구의 보좌입니까?', '["인간의 보좌", "천사의 보좌", "선지자의 보좌", "그리스도의 심판하시는 보좌"]'::jsonb, 3);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '이 세상에서 선악간 행한 바에 따라 받는 것은 무엇입니까?', '["칭찬", "면죄", "용서", "보응(報應)"]'::jsonb, 3);
insert into public.exam_questions (subject, question, options, answer) values ('신조', '믿지 아니하고 악을 행한 자가 받는 결과는 무엇입니까?', '["사(赦)함을 얻음", "정죄함을 입어 그 죄에 적당한 형벌을 받음", "무죄 선언", "영광 중에 영접받음"]'::jsonb, 1);

select subject as "과목", count(*) as "문항" from public.exam_questions group by subject order by 1;

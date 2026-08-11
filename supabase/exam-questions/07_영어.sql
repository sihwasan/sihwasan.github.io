-- =====================================================================
--  고시 문제 은행 7/8 : 영어 (16문항)
--  출처 : 「시화산노회 고시부 목사장로 고시가이드」 예상 문제 은행
--  * 이 과목만 다시 넣습니다. 여러 번 실행해도 문제가 늘어나지 않습니다.
-- =====================================================================

delete from public.exam_questions where subject = '영어';

insert into public.exam_questions (subject, question, options, answer) values ('영어', '다음 영어 성경 이름 중 한글 명칭이 올바르게 짝지어진 것은?', '["Exodus - 신명기", "Leviticus - 레위기", "Numbers - 창세기", "Genesis - 민수기"]'::jsonb, 1);
insert into public.exam_questions (subject, question, options, answer) values ('영어', '다음 영어 성경 이름 중 한글 명칭이 올바르지 않게 짝지어진 것은?', '["Song of Songs - 아가", "Ecclesiastes - 예레미야애가", "Psalms - 시편", "Proverbs - 잠언"]'::jsonb, 1);
insert into public.exam_questions (subject, question, options, answer) values ('영어', '다음 신약 성경 이름 중 한글 명칭이 올바르게 짝지어진 것은?', '["Romans - 사도행전", "Acts - 로마서", "Ephesians - 빌립보서", "Galatians - 갈라디아서"]'::jsonb, 3);
insert into public.exam_questions (subject, question, options, answer) values ('영어', '다음 영어 성경 이름 중 한글 명칭이 올바르지 않게 짝지어진 것은?', '["1 Peter - 베드로후서", "Revelation - 요한계시록", "James - 야고보서", "Hebrews - 히브리서"]'::jsonb, 0);
insert into public.exam_questions (subject, question, options, answer) values ('영어', '사도신경에서 "creator of heaven and earth"에 해당하는 우리말 표현은?', '["하늘과 땅의 창조자", "천지를 만드신 아버지 하나님", "천지를 만드신 분", "하늘과 땅을 만드신 분"]'::jsonb, 1);
insert into public.exam_questions (subject, question, options, answer) values ('영어', '사도신경에서 "suffered under Pontius Pilate"에 해당하는 우리말 표현은?', '["본디오 빌라도 때문에 고통스러워하셨다", "본디오 빌라도 아래에서 고난받으셨다", "본디오 빌라도에게 고통을 받으셨다", "본디오 빌라도에게 고난을 받으사"]'::jsonb, 3);
insert into public.exam_questions (subject, question, options, answer) values ('영어', '사도신경에서 "he ascended into heaven"에 해당하는 우리말 표현은?', '["하늘에 오르사", "하늘로 승천하셨다", "그는 하늘로 올라가셨다", "그는 천국으로 오르셨다"]'::jsonb, 0);
insert into public.exam_questions (subject, question, options, answer) values ('영어', '사도신경에서 "the communion of saints"에 해당하는 우리말 표현은?', '["성도들의 친교", "성도들의 모임", "성도가 서로 교통하는 것", "성도들의 교제"]'::jsonb, 2);
insert into public.exam_questions (subject, question, options, answer) values ('영어', '주기도문에서 "hallowed be Your name"에 해당하는 우리말 표현은?', '["이름이 거룩히 여김을 받으시오며", "당신의 이름이 거룩히 여김을 받으소서", "당신의 이름은 칭송받으소서", "당신의 이름은 거룩하다"]'::jsonb, 0);
insert into public.exam_questions (subject, question, options, answer) values ('영어', '주기도문에서 "Your will be done on earth as it is in heaven"에 해당하는 우리말 표현은?', '["뜻이 하늘에서 이루어진 것 같이 땅에서도 이루어지이다", "당신의 뜻이 땅에서 하늘처럼 이루어지소서", "하늘에 있는 당신의 뜻이 땅에서도 실현되소서", "당신의 뜻이 하늘에서처럼 땅에서도 이루어지소서"]'::jsonb, 0);
insert into public.exam_questions (subject, question, options, answer) values ('영어', '주기도문에서 "Give us today our daily bread"에 해당하는 우리말 표현은?', '["우리에게 오늘날의 양식을 주소서", "오늘 우리에게 필요한 식량을 주소서", "우리에게 매일의 빵을 주소서", "오늘날 우리에게 일용할 양식을 주옵시고"]'::jsonb, 3);
insert into public.exam_questions (subject, question, options, answer) values ('영어', '주기도문에서 "but deliver us from the evil one"에 해당하는 우리말 표현은?', '["그리고 우리를 악의 존재로부터 구하소서", "그러나 우리를 악으로부터 구하소서", "다만 우리를 악한 자에게서 구하소서", "다만 악에서 구하옵소서"]'::jsonb, 3);
insert into public.exam_questions (subject, question, options, answer) values ('영어', '"7 Dear friends, let us love one another, for love comes from God."에 해당하는 우리말 표현은?', '["사랑하는 형제자매들아, 서로 사랑하자, 사랑은 하나님에게서 비롯된다.", "친애하는 벗들아, 서로 사랑합시다, 사랑은 하나님에게서 나옵니다.", "사랑하는 자들아, 우리가 서로 사랑하자, 사랑은 하나님께로부터 온 것이기 때문이다.", "사랑하는 친구들아, 서로 사랑하자, 사랑은 하나님께로부터 온다."]'::jsonb, 2);
insert into public.exam_questions (subject, question, options, answer) values ('영어', '"8 Whoever does not love does not know God, because God is love."에 해당하는 우리말 표현은?', '["사랑하지 않는 자는 하나님을 알지 못한다, 왜냐하면 하나님은 사랑이시다.", "사랑하지 아니하는 자는 하나님을 알지 못하나니, 이는 하나님은 사랑이시기 때문이다.", "사랑하지 않는 사람은 하나님을 알 수 없다, 하나님은 곧 사랑이시기 때문이다.", "사랑이 없는 이는 하나님을 모른다, 하나님이 사랑이기 때문이다."]'::jsonb, 1);
insert into public.exam_questions (subject, question, options, answer) values ('영어', '"9 This is how God showed his love among us: He sent his one and only Son into the world that we might live through him."에 해당하는 우리말 표현은?', '["이것이 하나님이 우리에게 사랑을 보이신 방법이다: 그분은 그의 유일한 아들을 세상에 보내어 우리가 그를 통해 생명을 얻게 하셨다.", "하나님이 우리 가운데 그의 사랑을 이렇게 보여주셨다: 그는 그의 독생자를 세상에 보내셔서 우리가 그를 통해 살게 하셨다.", "하나님께서 우리에게 이렇게 사랑을 보여주셨다: 그분은 외아들을 세상에 보내어 우리가 그로 인해 살도록 하셨다.", "하나님의 사랑이 우리에게 이렇게 나타났으니: 그가 그의 독생자를 세상에 보내심은 우리로 말미암아 그를 통하여 살게 하려 하심이라."]'::jsonb, 3);
insert into public.exam_questions (subject, question, options, answer) values ('영어', '"10 This is love: not that we loved God, but that he loved us and sent his Son as an atoning sacrifice for our sins."에 해당하는 우리말 표현은?', '["이것이 사랑이다: 우리가 하나님을 사랑한 것이 아니라, 그가 우리를 사랑하시고 우리 죄를 위한 속죄 제물로 그의 아들을 보내신 것이다.", "이것이 곧 사랑이다: 우리가 하나님을 사랑해서가 아니라, 그분이 우리를 사랑하여 아들을 우리 죄를 위해 희생 제물로 주셨다.", "사랑은 이것이니: 우리가 하나님을 사랑한 것이 아니요, 하나님이 우리를 사랑하사 그의 아들을 우리 죄를 위한 화목 제물로 보내신 것이니라.", "참된 사랑은 이것이다: 우리가 하나님을 사랑한 것이 아니라, 그분이 우리를 사랑해서 그의 아들을 우리의 죄를 대속하는 희생물로 보내셨다."]'::jsonb, 2);

select subject as "과목", count(*) as "문항" from public.exam_questions group by subject order by 1;

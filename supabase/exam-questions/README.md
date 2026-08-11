# 고시 문제 은행 (과목별)

`supabase/19_exam.sql` 을 먼저 실행하신 뒤, 아래 파일을 순서대로 실행해 주세요.
한 번에 하나씩 붙여넣으시면 됩니다. 같은 파일을 다시 실행해도 문제가 중복되지 않습니다.

| 파일 | 문항 | 크기 |
|---|---|---|
| `01_목회학.sql` | 86 | 20KB |
| `02_정치.sql` | 163 | 30KB |
| `03_신조.sql` | 40 | 8KB |
| `04_권징조례.sql` | 154 | 31KB |
| `05_예배모범.sql` | 85 | 17KB |
| `06_상식.sql` | 88 | 18KB |
| `07_영어.sql` | 16 | 5KB |
| `08_소요리.sql` | 103 | 22KB |

전체 735문항입니다.

모두 넣으신 뒤 아래로 확인하실 수 있습니다.

```sql
select subject as "과목", count(*) as "문항"
  from public.exam_questions group by subject order by 2 desc;
```

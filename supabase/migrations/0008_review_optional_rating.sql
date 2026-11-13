-- 0008: 评分与训练时长改为可空。
-- 起因：课程完成、训练日志存在、评分存在是三个不同状态。原表要求 rating / actual_minutes
-- 必填，导致「只记录不评分」在数据层根本无法表达，统计也只能把未评分当成有记录。
-- 这里只放宽可空性并补一条「至少留一项内容」的约束，不改任何已有数据，也不动课程与课包逻辑。

alter table public.training_reviews alter column rating drop not null;
alter table public.training_reviews alter column actual_minutes drop not null;

alter table public.training_reviews drop constraint if exists training_reviews_rating_check;
alter table public.training_reviews
  add constraint training_reviews_rating_check check (rating is null or rating between 1 and 5);

alter table public.training_reviews drop constraint if exists training_reviews_actual_minutes_check;
alter table public.training_reviews
  add constraint training_reviews_actual_minutes_check check (actual_minutes is null or actual_minutes between 0 and 600);

-- 空记录没有信息价值，也容易与「有日志」混淆。
alter table public.training_reviews drop constraint if exists training_reviews_content_check;
alter table public.training_reviews
  add constraint training_reviews_content_check check (
    rating is not null or actual_minutes is not null or effort is not null or char_length(btrim(notes)) > 0
  );

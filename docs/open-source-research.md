# 开源调研与迁移记录
调研日期：2026-11-11。

| 项目 | 许可证 / 架构 | 本次决策 |
| --- | --- | --- |
| [wger](https://github.com/wger-project/wger) | AGPL-3.0；健身、营养、体重管理 | 功能范围较大，本次不引入代码、后端或素材 |
| [openGym](https://github.com/DuarteSantos8/openGym) | AGPL-3.0；训练记录、RPE/RIR、统计 | 参考训练努力程度与表现分开记录的方向，不复制代码或动作媒体 |
| [Ischys](https://github.com/ischys-app/Ischys) | MIT 代码；React Native/Expo + TypeScript | 局部迁移纯函数，不引入原生应用框架 |

## 实际移植
固定提交：`a776472aa72f902eabdcd5ae9e4adaff6897742a`
上游：[frontend/src/domain/chartRange.ts](https://github.com/ischys-app/Ischys/blob/a776472aa72f902eabdcd5ae9e4adaff6897742a/frontend/src/domain/chartRange.ts)
本地：`src/services/vendor/ischysTrend.ts`。
抽取 `trendPerMonth` 和对应常量，移除不相关的图表轴、格式化依赖。至少 4 个样本、跨度至少 21 天才计算每 30 天线性趋势。用于单个学员的评分变化，不将多学员平均评分解释为能力趋势。
完整 MIT 版权和授权文本保存在 `public/licenses/ischys.txt`，生产构建包含该文件。未复制上游图片、字体、运动数据库。其他评分、持久化、汇总及 Vue 界面为本项目实现。

## Tempo 统计口径
- 训练表现 1–5：教练主观评价，不是医学量表或生理能力测量。
- 用力程度 1–10：可选、教练代录学员反馈，与表现分开；无反馈为 null。
- 仅已完成且已发生的课程计入统计；按预约开始日期归属，使用浏览器本地日期筛选近 7/30/90 天（含今天）或全部。
- 每节课仅一份反馈，可修改；缺失评分不视作零分。实际分钟只累计已反馈课程。
- 趋势是主观评分的描述性线性斜率，不是未来预测，不表示健康结论。
- 已有 tempo.v1 数据缺少 reviews 时补空数组，不重置课程；反馈继续本地持久化。
- 结束课程后停留详情页，反馈可以跳过；从课表回顾或学员回顾进入补评。

## 后续
Supabase 阶段为反馈建立 booking_id 唯一约束、coach_id RLS 和服务端校验。学员自主提交与教练评分需独立身份来源；现版本只有教练代录。

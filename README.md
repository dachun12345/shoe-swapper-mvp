# 鞋子替换 · 商家生成工具（MVP）

商家上传 **3张产品图** + 1张模仿图/视频，框选“鞋子”目标区域，系统异步生成可下载的新图/新视频。

> 注意：当前版本为了演示“流程与架构”，默认使用 `mock-provider` 做占位合成（把第一张产品图叠到框选区域，并打 DEMO 水印）。  
> 你后续给我任意大模型的 API，我会按同一接口接入为新的 provider，实现真正的无痕替换与视频时序一致。

## 功能点
- ✅ 类目：仅支持「鞋子」
- ✅ 图片：3张产品图 + 1张模仿图 → 生成结果可下载
- ✅ 视频：3张产品图 + 1个模仿视频（<30秒）→ 生成结果可下载
- ✅ 框选/点选：用户拖拽框选要替换的鞋子区域
- ✅ 额外需求：文本框（默认提示“输入额外需求”）+ 8个示例快捷按钮
- ✅ 登录：邀请码登录（会话级；刷新页面需重新输入）
- ✅ 用量限制：邀请码用户每日 1000 次（可配置）
- ✅ 临时数据：刷新/离开页面即不再显示；服务端结果默认15分钟过期清理（可配置）

## 开发启动

1) 安装依赖
```bash
npm i
```

2) 配置环境变量
```bash
cp .env.example .env.local
```

3) 启动
```bash
npm run dev
```

打开：http://localhost:3000

默认示例邀请码：`DEMO2026`

## 多模型可插拔（你后续接API会用到）
目录：
- `src/lib/server/providers/types.ts`：Provider 接口定义
- `src/lib/server/providers/index.ts`：Provider 注册与默认选择
- `src/lib/server/providers/mockProvider.ts`：当前MVP占位实现

后续接入新模型时，我会：
1. 新增 `xxxProvider.ts` 实现 `ShoeSwapProvider`
2. 在 `providers/index.ts` 注册
3. 支持通过 `DEFAULT_PROVIDER` 或请求参数选择模型

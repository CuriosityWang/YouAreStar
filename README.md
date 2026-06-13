<p align="center">
  <b>简体中文</b> · <a href="./README.en.md">English</a>
</p>

<h1 align="center">YouAreStar · 广告牌替换器</h1>

<p align="center">把你的作品，放上时代广场的广告牌。</p>

浏览器里的合成工具：通过**透视变形（单应性 / homography）**加 **Reinhard 配色匹配**，把你的图片自然嵌进广告牌的广告位——看起来像它本就在那，而不是硬贴上去的。

<p align="center"><img src="./docs/hero.png" width="760" alt="YouAreStar 预览"></p>

## ✨ 特性

- **透视贴合** — 四点单应性，把图片变形对齐广告位的几何
- **配色匹配** — Reinhard lαβ 色彩迁移，让图片贴合场景光线，强度可调
- **两种模式** — 预制场景（角点已标好）/ 自定义上传（拖四个角标定广告面）
- **遮挡蒙版** — 让灯杆、行人等前景留在广告前方；手绘画笔或导入 PNG / 抠图（自动识别 alpha）
- **手动微调** — 亮度 / 对比 / 饱和 / 色温 / 混合模式 / 边缘羽化 / 噪点
- **所见即所得导出** — 同一套 WebGL 着色器驱动预览与导出，输出全分辨率 PNG
- **双语界面** — 中文 / English，自动记忆
- **纯前端** — 无后端，静态托管即可

## 🚀 快速开始

```bash
npm install
npm run dev        # 开发服务器 http://localhost:5173
npm run build      # 构建产物 → dist/
npm run preview    # 本地预览生产构建
```

## 🧱 技术栈

React 18 · Vite 5 · TypeScript · 原生 WebGL（单 full-screen pass 着色器：透视 + 配色 + 蒙版 + 颗粒一次绘制）· framer-motion。无 CSS 框架，无后端。

## 📦 部署

纯静态站：`npm run build` 产出 `dist/`，把 `dist/` 里的内容托管到任意静态服务器（nginx / 对象存储 / CDN）即可。仓库附带 `deploy.sh`（本地构建 + `rsync` 增量上传到服务器），服务器地址写在被 git 忽略的 `deploy.env`（见 `deploy.env.example`），不会泄露。

## 📂 项目结构（关键）

| 路径 | 作用 |
| --- | --- |
| `src/lib/webgl/` | 着色器与渲染器（一次绘制完成所有效果） |
| `src/lib/homography.ts` | 四点 DLT 求单应矩阵 |
| `src/lib/color.ts` | lαβ 配色统计（CPU 侧，与着色器保持一致） |
| `src/hooks/useEditor.ts` | 编辑器状态，单一数据源 |
| `src/data/billboards.json` | 预制场景数据 |

## 📄 许可

[MIT](./LICENSE) © Wang Xin

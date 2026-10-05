# Image Picka 致谢与改编范围

MAHO 拾图基于本工作区原有的“慢慢拾图”Manifest V3 项目继续开发，
参考 Image Picka 0.23.2 的交互和部分实现，不是 Image Picka 官方版本。

- 上游：https://github.com/eight04/image-picka
- 作者版权：Copyright (c) 2017 eight
- 许可：MIT，完整原文见 licenses/Image-Picka-MIT.txt。
- vendor/picka-escape.js 改编自 src/lib/escape.js，
  原文件 Git blob：f29a492fb087e03a6f7db76732e52530f44c47ca。
  改动：移除 Android / Firefox 偏好配置依赖，改为显式 options 参数。
- quick.js 的候选图片选择优先级参考 src/lib/image-util.js，
  原文件 Git blob：0f12de1b893a895d6d8da71f5014951d03d30dde。
  改为按需注入、自有解析和收集篮流程。
- 改编日期：2026-10-05。

上游 Manifest V2 的后台、全站常驻脚本、模板表达式求值与网络拦截模块没有移植。
MAHO 使用 Manifest V3、按需页面访问和浏览器自带下载 API。
无外部脚本/CDN、无账号系统、无收费功能、无统计接口。

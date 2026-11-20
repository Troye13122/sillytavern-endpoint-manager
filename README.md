# 端点收藏夹 · Custom Endpoint Manager

一个给 **SillyTavern** 的「Custom (OpenAI-compatible)」端点用的小扩展：

> 多 URL 收藏、自定义名称、每个 URL 绑定多把 Key、一键切换，不用再反复找 URL 复制粘贴。

支持 SillyTavern 1.12+，在 1.18.0 上测试通过。

## 为什么

SillyTavern 只有一个「Custom Endpoint」输入框。渠道一多，每次切换都要：

1. 打开某个笔记 / 浏览器收藏；
2. 找到对应 URL；
3. 复制、粘贴；
4. 再去找对应的 Key。

这个扩展把 URL 和 Key 做成「收藏夹」：

- URL 有名字，能搜索、能改名；
- 一个 URL 可以存多把 Key；
- 在原生输入框下方直接下拉切换；
- 切换后可选自动 Connect。

## 功能

- **多 URL 收藏**：每个端点自定义名称，例如「北棱改文站」「casino」「公司中转」。
- **URL ↔ Key 绑定**：每个端点独立维护 key 列表。
- **一个 URL 多把 Key**：同一端点下可保存任意多把，随时切换。
- **快捷下拉**：在「Custom Endpoint」和「Custom API Key」下方直接切换。
- **命名后创建**：点 `＋` 先弹命名框，确认名称 / URL / 模型后再创建。
- **管理弹窗**：新建、改名、改 URL、改模型、添加/导入/改名/移除 Key、搜索。
- **自动连接**：切换后默认自动点一次 Connect，可在扩展设置里关闭。
- **不复制 Key 明文**：Key 仍保存在酒馆的 `secrets.json`；扩展只记录 `secretId`、标签和掩码尾缀。

## 安装

### 方式一：git clone（推荐）

```bash
cd SillyTavern/public/scripts/extensions/third-party
git clone https://github.com/Troye13122/sillytavern-endpoint-manager.git
```

### 方式二：下载 ZIP

下载仓库 ZIP，解压到：

```text
SillyTavern/public/scripts/extensions/third-party/sillytavern-endpoint-manager/
```

确认目录里能看到 `manifest.json`、`index.js`、`style.css`。

然后刷新酒馆页面（建议 `Ctrl+F5`）。不需要重启服务。

## 使用

1. 打开 **API Connections → Chat Completion → Custom (OpenAI-compatible)**。
2. 在 **Custom Endpoint (Base URL)** 下方：
   - 下拉框：选择已收藏的端点，选中即切换；
   - `＋`：弹出命名框，预填当前 URL / 模型，确认后创建；
   - `⚙`：打开「端点收藏夹」管理弹窗。
3. 在 **Custom API Key** 下方：
   - 下拉框：选择该端点绑定的 key，选中即切换；
   - `＋`：给当前端点添加新 key。
4. 管理弹窗里：
   - 选中端点后，顶部可改 **名称 / Base URL / 模型**，点「保存」；
   - Key 区域可添加、从酒馆已有密钥导入、改名、移除、设为当前；
   - 右上角「新建」会弹出空白命名框；「导入当前」会预填当前端点。
5. 自动连接开关：**Extensions 面板 → 端点收藏夹**。

界面大致是这样：

```text
Custom Endpoint (Base URL)
[ https://revnovel.org/v1                  ]
[ 北棱改文站 · revnovel.org/v1  ▾ ] [＋] [⚙]

Custom API Key
[ 密钥已保存 ...                           ] [🔑]
[ ✓ 酒馆 key · sk-...60JY  ▾ ] [＋]
```

## 数据存在哪

| 数据 | 位置 |
| --- | --- |
| 端点名称 / URL / 模型 / Key 引用 | `data/default-user/settings.json` → `extension_settings.custom_endpoint_manager` |
| Key 明文 | `data/default-user/secrets.json` → `api_key_custom`（由酒馆管理） |

扩展不会把 Key 明文写进 `settings.json`。

## 注意

- 从收藏夹「移除」key 不会删除酒馆里的 secret；需要清理时到酒馆的钥匙管理里删除。
- 扩展只负责切换，不校验 URL / key 是否可用；切换后能否连上取决于渠道本身。
- Key 的切换走酒馆自己的 `rotateSecret`，新增 key 会出现在酒馆的密钥列表里。
- 如果酒馆升级后 `secrets.js` 接口或输入框 ID 发生变化，扩展可能需要跟着调整。

## 开发

无构建步骤，纯静态文件：

```text
manifest.json   扩展清单
index.js        逻辑
style.css       样式
README.md       说明
```

语法检查（ES module）：

```bash
cp index.js /tmp/check.mjs && node --check /tmp/check.mjs
```

## License

MIT

# 贡献指南

首先，感谢你考虑为 Luna Forum 做出贡献！🎉

Luna Forum 是一个正在积极开发中的项目，我们欢迎各种形式的贡献，包括但不限于：

- 🐛 报告 Bug
- 💡 提出新功能建议
- 📝 改进文档
- 🔧 提交代码修复
- ✨ 开发新功能或插件

## 目录

- [行为准则](#行为准则)
- [如何贡献](#如何贡献)
- [开发流程](#开发流程)
- [代码风格](#代码风格)
- [提交规范](#提交规范)
- [插件开发](#插件开发)
- [问题反馈](#问题反馈)

## 行为准则

请保持友善和尊重。我们希望 Luna Forum 社区对每个人都是友好和包容的。

- 使用欢迎和包容的语言
- 尊重不同的观点和经验
- 优雅地接受建设性批评
- 关注什么对社区最有利
- 对其他社区成员表示同理心

## 如何贡献

### 报告 Bug

在提交 Bug 报告之前，请先：

1. 检查 [Issues](https://github.com/imsunxinhao/luna-forum/issues) 中是否已有相同或类似的问题
2. 确认你使用的是最新的代码

创建 Bug 报告时，请包含以下信息：

```markdown
**Bug 描述**
清晰简洁地描述问题是什么。

**复现步骤**
1. 执行 '...'
2. 点击 '....'
3. 看到错误 '....'

**预期行为**
描述你期望发生的事情。

**截图**
如果适用，添加截图帮助解释问题。

**环境信息：**
 - OS: [e.g. Ubuntu 22.04]
 - Node.js 版本: [e.g. 18.17.0]
 - MongoDB 版本: [e.g. 7.0]
 - 项目版本/分支: [e.g. main branch]
```

### 提出新功能

功能建议请包含：

1. 清晰的功能描述
2. 使用场景（为什么需要这个功能？）
3. 可能的实现方式（如果有想法）
4. 是否愿意自己实现这个功能

## 开发流程

### 环境准备

```bash
# 1. Fork 并克隆仓库
git clone https://github.com/your-username/Luna-Forum.git
cd Luna-Forum

# 2. 安装依赖
npm install

# 3. 设置环境变量
cp .env.example .env
# 编辑 .env 文件，配置你的本地环境

# 4. 启动开发服务器
npm run dev
```

### 开发工作流

1. 从 `main` 分支创建新分支
   ```bash
   git checkout -b feature/your-feature-name
   # 或
   git checkout -b fix/your-bug-fix
   ```

2. 进行你的修改
   - 保持修改聚焦，一次只解决一个问题
   - 遵循现有的代码风格
   - 添加必要的注释

3. 本地测试
   ```bash
   # 构建项目，确保没有编译错误
   npm run build
   
   # 启动项目进行手动测试
   npm run dev
   ```

4. 提交前检查
   ```bash
   # 检查代码格式（如果配置了）
   npm run lint  # 如果有的话
   
   # 检查 TypeScript 类型
   npm run type-check  # 如果有的话
   ```

5. 提交并推送
   ```bash
   git add .
   git commit -m "feat: 添加新功能"
   git push origin feature/your-feature-name
   ```

6. 创建 Pull Request
   - 填写 PR 模板中的所有信息
   - 引用相关的 Issue（如果有）
   - 等待代码审查

## 代码风格

### TypeScript

- 使用 TypeScript 严格模式
- 优先使用 `interface` 而不是 `type`（除非需要联合类型等特性）
- 使用有意义的变量和函数名
- 避免使用 `any`，必要时使用 `unknown`
- 导出类型时使用显式导出

```typescript
// ✅ 推荐
interface UserProfile {
  id: string;
  username: string;
  email: string;
}

async function getUserProfile(userId: string): Promise<UserProfile | null> {
  // 实现
}

// ❌ 避免
function getData(id: any): any {
  // 实现
}
```

### 命名约定

- 文件名：使用 kebab-case（例如：`user-service.ts`）
- 类名：使用 PascalCase（例如：`UserService`）
- 函数和变量：使用 camelCase（例如：`getUserById`）
- 常量：使用 UPPER_SNAKE_CASE（例如：`MAX_RETRY_COUNT`）

### 项目结构

```
src/
├── core/           # 核心功能
├── plugins/        # 插件系统
├── routes/         # API 路由
├── services/       # 业务逻辑
├── models/         # 数据模型
├── types/          # TypeScript 类型定义
└── utils/          # 工具函数
```

## 提交规范

我们使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

```
<type>(<scope>): <subject>
```

### Type 类型

- `feat`: 新功能
- `fix`: Bug 修复
- `docs`: 文档更新
- `style`: 代码格式（不影响代码运行的变动）
- `refactor`: 重构
- `perf`: 性能优化
- `test`: 测试相关
- `build`: 构建系统或外部依赖
- `ci`: CI 配置文件和脚本
- `chore`: 其他不修改 src 或 test 的修改
- `revert`: 回退之前的提交

### 示例

```bash
git commit -m "feat: 添加用户注册接口"
git commit -m "fix: 修复帖子列表分页错误"
git commit -m "docs: 更新 API 文档"
git commit -m "refactor: 重构数据库连接模块"
```

## 插件开发

Luna Forum 采用插件化架构，开发插件时请注意：

### 插件结构

```typescript
// plugins/my-plugin/index.ts
import type { Plugin } from '@luna-forum/core';

const plugin: Plugin = {
  name: 'my-plugin',
  version: '1.0.0',
  description: '我的第一个 Luna Forum 插件',
  
  async activate(context) {
    // 插件激活时的逻辑
    console.log('插件已激活');
  },
  
  async deactivate() {
    // 插件停用时的清理工作
    console.log('插件已停用');
  }
};

export default plugin;
```

### 插件开发指南

1. 查看 `src/plugins/` 目录下的示例插件
2. 遵循 [插件开发文档](https://docs.yaojingluntan.moe/plugins)
3. 确保插件可以被正确加载和卸载
4. 处理好错误和边界情况

## 问题反馈

如果你有任何疑问或需要帮助：

- 在 [Issues](../../issues) 中创建问题
- 在 [Discussions](../../discussions) 中发起讨论
- 查看[在线文档](https://docs.yaojingluntan.moe)

## 关于测试

目前项目还在早期开发阶段，尚未建立完整的测试体系。我们计划在未来引入：

- **单元测试**：使用 Jest 或 Vitest
- **集成测试**：测试 API 端点和数据库交互
- **端到端测试**：使用 Playwright 测试完整用户流程

在测试体系建立之前，请确保：

1. 你的代码可以通过 TypeScript 编译
2. 手动测试你的功能是否正常工作
3. 说明你进行了哪些手动测试

---

再次感谢你的贡献！每一份贡献都对 Luna Forum 的成长非常重要。💜

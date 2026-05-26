# My Team Open Tickets - 树状人员图设计方案

## 问题陈述
在 ServiceNow 查询预设中加入 "My Team Open Tickets"，按 manager-employee 层级关系查询下属的 open tickets，支持递归展开树状人员图。

## 当前状态
- `panel.js` 有 `PRESETS` 预设查询系统
- `panel.html` 有下拉选择框和 `list-result` 结果区域
- `background.js` 通过 `chrome.scripting.executeScript` 在 SNOW page context 执行 REST API 查询
- 现有渲染逻辑支持 ticket card（排序、stale badge、action links）

## 架构变更

### 新增 Background Actions

1. **`getMyTeamHierarchy`**
   - 获取当前用户 `sys_id`
   - **DFS 递归**查询 `sys_user` 表（`manager=parentId`），构建组织架构树
   - 对每个节点并行查询各表直接名下的 open ticket count
   - 返回树结构（含 `name`, `sys_id`, `directReports`, `counts`, `total`）
   - 如果当前用户无下属 → 返回错误 `"No direct reports"`

2. **`getTeamMemberTickets(memberSysId)`**
   - 对指定 member 做 DFS 递归获取其所有下属 `sys_id`（含自身）
   - 并行查询所有表的 open tickets：`assigned_toIN[ids]^${openCondition}`
   - 合并结果，按 `sys_updated_on` 升序排序，截断 limit
   - 复用现有 ticket card 渲染

### 新增/修改的 Panel 逻辑

1. **PRESETS 添加**
   ```javascript
   "my-team-open": "__TEAM__"
   ```

2. **`btn-list` handler 分支**
   - 检测到 `my-team-open` → 调用 `getMyTeamHierarchy`
   - 渲染树状人员图（见下方 UI 设计）

3. **树渲染函数 `renderTeamTree(tree, container)`**
   - 递归渲染每个节点
   - 每个节点：展开/折叠按钮（如有下属）+ 人名 + 各表 count + Total
   - 人名可点击 → 调用 `getTeamMemberTickets(sysId)` → 渲染 ticket cards
   - ticket 区域顶部显示 "← Back to Team" 返回树视图

4. **新增 CSS（panel.html inline `<style>`）**
   - `.team-tree-node`：层级缩进（padding-left per level）
   - `.team-toggle`：展开/折叠按钮（▶/▼）
   - `.team-member-card`：人名行样式
   - `.team-counts`：各表 count 标签

## UI 设计：树状人员图

```
My Team Open Tickets
┌──────────────────────────────────────────────┐
│ ▼ 张三 (Manager)                               │
│   ├─ INC: 3 | CHG: 1 | TSK: 0 | Total: 4      │
│   │                                           │
│   ├─ ▶ 李四 (Manager)                         │
│   │   INC: 1 | CHG: 0 | TSK: 0 | Total: 1     │
│   │                                           │
│   └─ ▼ 王五                                   │
│       INC: 2 | CHG: 0 | TSK: 0 | Total: 2     │
│                                               │
│ ▶ 赵六                                        │
│   INC: 0 | CHG: 0 | TSK: 0 | Total: 0         │
└──────────────────────────────────────────────┘
```

- 点击 ▶/▼ 展开/折叠下属
- 点击人名（如"张三"）→ 查询张三及所有递归下属的所有 open tickets
- 显示各表 count：`INC`, `CHG`, `PRB`, `RIT`, `REQ`, `TSK`, `SCT`, `Total`
- 如果 count 全为 0，人名灰色显示

## 后台 API 详细设计

### getMyTeamHierarchy 流程

```
1. 获取当前用户 sys_id（复用 getUserIdInPage）
2. DFS 递归函数 getSubordinates(parentSysId):
   a. 查询 sys_user: manager=${parentSysId}^active=true
   b. 对每个用户 (userId, name):
      i.   并行查询各表 count（assigned_to=${userId}^${openCondition}）
      ii.  递归调用 getSubordinates(userId) 获取 directReports
   c. 返回 [{ name, sys_id, counts, total, directReports }]
3. 如果根节点结果为空 → 抛出 "No direct reports"
4. 返回树数组
```

### getTeamMemberTickets 流程

```
1. DFS 函数 collectAllSubordinateIds(parentSysId):
   a. 查询 sys_user: manager=${parentSysId}^active=true，收集 sys_id
   b. 对每个结果递归收集
   c. 返回 [parentSysId, ...所有下属 sys_id]

2. 对以下各表并行查询（assigned_toIN[ids]^${openCondition}）:
   - incident: active=true
   - change_request: stateIN-5,-4,-3,-2,-1,0
   - problem: stateIN101,102,103,104
   - task: active=true
   - sc_req_item: stateIN1,2
   - sc_request: state=-5
   - sc_task: stateIN-5,1,2

3. 合并所有表结果，按 sys_updated_on 升序排序
4. 截断 limit，返回 tickets 数组
```

## 表与 Open 条件映射

| 表 | Open 条件 |
|---|---|
| `incident` | `active=true` |
| `change_request` | `stateIN-5,-4,-3,-2,-1,0` |
| `problem` | `stateIN101,102,103,104` |
| `task` | `active=true` |
| `sc_req_item` | `stateIN1,2` |
| `sc_request` | `state=-5` |
| `sc_task` | `stateIN-5,1,2` |

## 错误处理

- 无法获取当前用户 → "Could not determine current user"
- 当前用户没有下属（含递归）→ **"No direct reports"**
- 某表 count 查询失败 → count 为 0，不影响其它表
- 某表 tickets 查询失败 → 静默跳过，返回空数组
- 递归深度过大（>10）→ 截断，防止无限递归

## 性能考虑

- 组织架构通常层级不深（3-5 层），人数可控
- `getMyTeamHierarchy` 中对每个节点并行查询 7 个表的 count
- `getTeamMemberTickets` 中 7 表并行查询
- 所有查询在 page context 通过 `snowFetch` 执行，复用现有 session

## 不实现的功能（YAGNI）

- 不在树视图中显示 ticket 预览（避免一次查询过多数据）
- 不缓存组织架构树（每次点击重新查询，保证数据最新）
- 不添加 "刷新" 按钮（返回树视图即重新查询）

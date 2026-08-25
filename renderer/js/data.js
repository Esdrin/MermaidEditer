'use strict';
window.ME = window.ME || {};

/* ---------------- 流程图节点形状 ----------------
 * t[0] = 起始 token，t[1] = 结束 token（mermaid 语法）
 */
ME.SHAPES = [
  { id: 'rect', label: '矩形', sub: '处理过程', t: ['[', ']'], icon: '<rect x="3" y="5.5" width="18" height="13"/>' },
  { id: 'rounded', label: '圆角矩形', sub: '过程', t: ['(', ')'], icon: '<rect x="3" y="5.5" width="18" height="13" rx="3"/>' },
  { id: 'stadium', label: '两端圆弧', sub: '开始 / 结束', t: ['([', '])'], legacyEnd: ')]', icon: '<rect x="3" y="5.5" width="18" height="13" rx="6.5"/>' },
  { id: 'diamond', label: '菱形', sub: '判断', t: ['{', '}'], icon: '<path d="M12 3.5L21 12l-9 8.5L3 12z"/>' },
  { id: 'parallelogram', label: '平行四边形', sub: '数据', t: ['[/', '/]'], icon: '<path d="M6 5.5h12l-2.5 13H3.5z"/>' },
  { id: 'parallelogram-alt', label: '平行四边形(左)', sub: '数据', t: ['[\\', '\\]'], icon: '<path d="M7.5 5.5h12L17 18.5H5z"/>' },
  { id: 'trapezoid', label: '梯形', sub: '手动输入', t: ['[/', '\\]'], icon: '<path d="M4.5 5.5h15L16.5 18.5h-9z"/>' },
  { id: 'trapezoid-alt', label: '梯形(倒)', sub: '手动输入', t: ['[\\', '/]'], icon: '<path d="M7.5 5.5h9L13 18.5H4z"/>' },
  { id: 'hexagon', label: '六边形', sub: '准备', t: ['{{', '}}'], icon: '<path d="M7 5.5h10l4 6.5-4 6.5H7l-4-6.5z"/>' },
  { id: 'circle', label: '圆形', sub: '连接点', t: ['((', '))'], icon: '<circle cx="12" cy="12" r="8"/>' },
  { id: 'doublecircle', label: '双圆形', sub: '连接点', t: ['(((', ')))'], icon: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.6"/>' },
  { id: 'subroutine', label: '子程序', sub: '预定义过程', t: ['[[', ']]'], icon: '<rect x="3" y="5.5" width="18" height="13"/><path d="M7 5.5v13M17 5.5v13"/>' },
  { id: 'database', label: '数据库', sub: '数据存储', t: ['[(', ')]'], legacyEnd: ')', icon: '<ellipse cx="12" cy="6.3" rx="8.5" ry="2.7"/><path d="M3.5 6.3v11.4a8.5 2.7 0 0 0 17 0V6.3"/>' },
  { id: 'asymmetric', label: '旗形', sub: '文档', t: ['>', ']'], icon: '<path d="M4.5 5.5h10.5l4.5 6.5-4.5 6.5H4.5z"/>' },
];

/* ---------------- 连接线 ---------------- */
ME.EDGES = [
  { id: 'arrow', label: '箭头', conn: '-->', icon: '<path d="M3.5 12H18"/><path d="M14 8.2L18.3 12 14 15.8"/>' },
  { id: 'dashed-arrow', label: '虚线箭头', conn: '-.->', icon: '<path d="M3.5 12H18" stroke-dasharray="3.2 2.6"/><path d="M14 8.2L18.3 12 14 15.8"/>' },
  { id: 'bold-arrow', label: '粗箭头', conn: '==>', icon: '<path d="M3.5 10.6H15"/><path d="M3.5 13.4H15"/><path d="M13.5 7.8L19 12l-5.5 4.2"/>' },
  { id: 'line', label: '直线（无箭头）', conn: '---', icon: '<path d="M3.5 12H20.5"/>' },
  { id: 'dashed', label: '虚线', conn: '-.-', icon: '<path d="M3.5 12H20.5" stroke-dasharray="3.2 2.6"/>' },
  { id: 'circle-end', label: '圆圈端点', conn: '--o', icon: '<path d="M3.5 12H15.5"/><circle cx="18" cy="12" r="2.4"/>' },
  { id: 'cross-end', label: '叉形端点', conn: '--x', icon: '<path d="M3.5 12H14.5"/><path d="M16.5 10l4 4M20.5 10l-4 4"/>' },
  { id: 'label-arrow', label: '带标签箭头', conn: '-->', hasLabel: true, icon: '<path d="M3.5 9.5H18"/><path d="M14 5.7L18.3 9.5 14 13.3"/><path d="M3.5 15h6" stroke-dasharray="2.5 2"/>' },
];

/* ---------------- 图类型模板 ---------------- */
ME.TEMPLATES = [
  {
    id: 'flow', label: '流程图', sub: 'flowchart',
    icon: '<circle cx="4" cy="6" r="1.6"/><path d="M5.6 6H12"/><path d="M13.5 6h5"/><circle cx="20" cy="6" r="1.6"/><path d="M12 7.5v4"/><path d="M7 11.5h10"/><path d="M12 11.5v4"/><circle cx="12" cy="18.5" r="1.6"/>',
    code: 'flowchart TD\n    A[开始] --> B{是否就绪}\n    B -- 是 --> C[执行任务]\n    C --> D[结束]\n    B -- 否 --> A\n',
  },
  {
    id: 'sequence', label: '序列图', sub: 'sequenceDiagram',
    icon: '<path d="M4 5h16"/><path d="M7 5v14M17 5v14"/><path d="M5.5 19h13"/><path d="M9.5 9l4.5 2.5L9.5 14z" fill="currentColor" stroke="none"/>',
    code: 'sequenceDiagram\n    participant A as 用户\n    participant B as 系统\n    A->>B: 发起请求\n    B-->>A: 返回响应\n    alt 成功\n        B->>A: 处理结果\n    else 失败\n        B->>A: 错误信息\n    end\n',
  },
  {
    id: 'class', label: '类图', sub: 'classDiagram',
    icon: '<rect x="3.5" y="4" width="17" height="6.5"/><rect x="3.5" y="12" width="17" height="8"/><path d="M3.5 10.5h17"/>',
    code: 'classDiagram\n    class Animal {\n        +String name\n        +eat()\n    }\n    class Dog {\n        +bark()\n    }\n    Animal <|-- Dog\n',
  },
  {
    id: 'state', label: '状态图', sub: 'stateDiagram-v2',
    icon: '<circle cx="5" cy="12" r="2"/><path d="M7 12h3"/><rect x="10" y="8.5" width="10" height="7" rx="2"/><circle cx="15" cy="12" r="1" fill="currentColor" stroke="none"/>',
    code: 'stateDiagram-v2\n    [*] --> 空闲\n    空闲 --> 运行 : 启动\n    运行 --> 空闲 : 停止\n    运行 --> [*] : 结束\n',
  },
  {
    id: 'er', label: 'ER 图', sub: 'erDiagram',
    icon: '<rect x="3.5" y="5" width="7" height="6" rx="1"/><rect x="13.5" y="5" width="7" height="6" rx="1"/><rect x="3.5" y="14" width="7" height="6" rx="1"/><rect x="13.5" y="14" width="7" height="6" rx="1"/><path d="M10.5 8h3M10.5 17h3"/><circle cx="12" cy="8" r="1.4"/><circle cx="12" cy="17" r="1.4"/>',
    code: 'erDiagram\n    CUSTOMER ||--o{ ORDER : places\n    ORDER ||--|{ LINE-ITEM : contains\n    CUSTOMER {\n        string name\n        string email\n    }\n    ORDER {\n        int id\n        date orderDate\n    }\n',
  },
  {
    id: 'gantt', label: '甘特图', sub: 'gantt',
    icon: '<path d="M3.5 5h17v14H3.5z"/><path d="M3.5 9.5h17M3.5 14h17"/><rect x="6" y="6.5" width="8" height="2.5" fill="currentColor" stroke="none"/><rect x="8" y="11" width="9" height="2.5" fill="currentColor" stroke="none"/><rect x="5.5" y="15.5" width="7" height="2.5" fill="currentColor" stroke="none"/>',
    code: 'gantt\n    title 项目计划\n    dateFormat  YYYY-MM-DD\n    section 设计\n    需求分析      :a1, 2026-08-01, 7d\n    原型设计      :after a1, 5d\n    section 开发\n    编码实现      :2026-08-13, 14d\n    测试          :2026-08-27, 7d\n',
  },
  {
    id: 'pie', label: '饼图', sub: 'pie',
    icon: '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M12 3a9 9 0 0 1 9 9" stroke-dasharray="2.5 2"/>',
    code: 'pie title 市场份额\n    "A 产品" : 45\n    "B 产品" : 30\n    "C 产品" : 25\n',
  },
  {
    id: 'journey', label: '旅程图', sub: 'journey',
    icon: '<path d="M3.5 15h17"/><path d="M3.5 15v3h17v-3"/><path d="M3.5 9h17"/><circle cx="6" cy="9" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="9" r="1.4" fill="currentColor" stroke="none"/><circle cx="18" cy="9" r="1.4" fill="currentColor" stroke="none"/>',
    code: 'journey\n    title 用户旅程\n    section 浏览\n        打开页面: 5: 用户\n        搜索: 3: 用户\n    section 购买\n        下单: 4: 用户\n        支付: 5: 用户\n',
  },
  {
    id: 'mindmap', label: '思维导图', sub: 'mindmap',
    icon: '<circle cx="12" cy="12" r="2.4"/><path d="M11 10.5L6 8M14 9.5l5-3.5M13 14l4 4M10 14l-4 3.5"/>',
    code: 'mindmap\n  root((项目))\n    规划\n      需求分析\n      原型设计\n    执行\n      开发\n      测试\n    发布\n      上线\n      维护\n',
  },
  {
    id: 'timeline', label: '时间线', sub: 'timeline',
    icon: '<path d="M3.5 8h17M3.5 16h17"/><circle cx="7" cy="8" r="1.4" fill="currentColor" stroke="none"/><circle cx="13" cy="8" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="8" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="16" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="16" r="1.4" fill="currentColor" stroke="none"/>',
    code: 'timeline\n    title 项目里程碑\n    2026 Q1 : 需求分析 : 原型设计\n    2026 Q2 : 开发 : 测试\n    2026 Q3 : 发布上线\n',
  },
  {
    id: 'git', label: 'Git 图', sub: 'gitGraph',
    icon: '<path d="M4 5h16"/><path d="M10 5v3h8"/><path d="M18 5v8"/><circle cx="4" cy="16" r="2"/><circle cx="10" cy="19" r="2"/><circle cx="18" cy="13" r="2"/>',
    code: 'gitGraph\n    commit id: "初始版本"\n    branch dev\n    checkout dev\n    commit id: "功能开发"\n    checkout main\n    merge dev\n    commit id: "发布"\n',
  },
];

/* ---------------- 设计选项 ---------------- */
ME.THEMES = [
  { value: 'default', label: '默认' },
  { value: 'neutral', label: '中性' },
  { value: 'dark', label: '深色' },
  { value: 'forest', label: '森林' },
  { value: 'base', label: '基础' },
];

ME.DIRECTIONS = [
  ['TB', '从上到下'],
  ['LR', '从左到右'],
  ['BT', '从下到上'],
  ['RL', '从右到左'],
];

ME.CURVES = [
  ['basis', '贝塞尔曲线'],
  ['linear', '直线'],
];

ME.FONTS = [
  ['微软雅黑', '"Microsoft YaHei"'],
  ['宋体', '"SimSun"'],
  ['黑体', '"SimHei"'],
  ['楷体', '"KaiTi"'],
  ['Arial', 'Arial'],
  ['Times New Roman', '"Times New Roman"'],
  ['Courier New', '"Courier New"'],
  ['Georgia', 'Georgia'],
];

ME.SIZES = [12, 14, 16, 18, 22, 28, 36];

ME.SWATCHES = ['#ffffff', '#f4f4f4', '#ffe699', '#f4cccc', '#d9ead3', '#cfe2f3', '#d9d2e9', '#000000'];

ME.DIAGRAM_TYPES = {
  flow: '流程图', sequence: '序列图', class: '类图', state: '状态图',
  er: 'ER 图', gantt: '甘特图', pie: '饼图', journey: '旅程图',
  mindmap: '思维导图', timeline: '时间线', git: 'Git 图',
};

/* ---------------- 形状分类（插入页按用途拆分） ---------------- */
ME.SHAPE_GROUPS = {
  flow: {
    title: '流程',
    ids: ['rect', 'rounded', 'stadium', 'diamond', 'trapezoid', 'trapezoid-alt', 'hexagon'],
  },
  data: {
    title: '数据',
    ids: ['parallelogram', 'parallelogram-alt', 'database', 'asymmetric'],
  },
  struct: {
    title: '结构',
    ids: ['circle', 'doublecircle', 'subroutine'],
  },
};

ME.DEFAULT_SRC = 'flowchart TD\n    A[开始] --> B{是否就绪}\n    B -- 是 --> C[执行任务]\n    C --> D[结束]\n    B -- 否 --> A\n';

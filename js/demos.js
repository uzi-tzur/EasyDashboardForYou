// Demo templates: ready-made dashboards with sample rows. Rows are in `headers` order;
// each header matches a field's `source`.
window.DEMOS = [
  {
    id: 'release',
    name: 'Release Tracking',
    description: 'Track items across releases, environments and approval status.',
    headers: ['Item ID', 'Release', 'Component', 'Workstream', 'Ticket', 'Description', 'Environment', 'Status', 'Release Note'],
    rows: [
      ['ITEM-001', 'Release 1', 'Component A', 'Workstream A', 'TICKET-1001', 'Configuration requires validation before deployment', 'Test Env 1, Test Env 2', 'Certified, ready to deploy after PL', 'Not assigned'],
      ['ITEM-002', 'Release 2', 'Component A', 'Workstream A', '', 'Connectivity issue requires environment confirmation', 'Test Env 1', 'Testing complete, Dev Confirmation Pending', 'Not assigned'],
      ['ITEM-003', 'Release 2', 'Component A', 'Workstream A', 'TICKET-1002', 'Service configuration changes require merge', 'Test Env 1, Test Env 2', 'Certified, release note pending', 'Not assigned'],
      ['ITEM-004', 'Release 3', 'Component A', 'Workstream A', 'TICKET-1003', 'Resource configuration update', 'Test Env 1, Test Env 2', 'Testing complete, Dev Confirmation Pending', 'Not assigned'],
      ['ITEM-005', 'Release 2', 'Component A', 'Workstream A', 'TICKET-1004', 'Follow-up for load behavior', 'Test Env 1, Test Env 2', 'Testing complete, Dev Confirmation Pending', 'Not assigned'],
      ['ITEM-006', 'Release 2', 'Component A', 'Workstream A', '', 'Runtime options change for application service', 'Test Env 2, Test Env 1', 'Testing complete, Dev Confirmation Pending', 'Not assigned'],
      ['ITEM-007', 'Release 3', 'Component A', 'Workstream A', 'TICKET-1005', 'Update database connection pool values', 'Test Env 2, Test Env 1', 'Testing complete, Dev Confirmation Pending', 'Not assigned'],
      ['ITEM-008', 'Release 3', 'Component A', 'Workstream A', 'TICKET-1006', 'Upgrade health-check service components', 'Test Env 2, Test Env 1', 'Created', 'Not assigned'],
      ['ITEM-009', 'Release 3', 'Component A', 'Workstream A', 'TICKET-1007', 'Attach updated configuration files for review', 'Test Env 2', 'Approved', 'Not assigned'],
      ['ITEM-010', 'Release 3', 'Component A', 'Workstream A', 'TICKET-1007', 'Configuration update planned for deployment', 'Test Env 1', 'Certified, ready to deploy after PL', 'Not assigned'],
      ['ITEM-011', 'Release 3', 'Component A', 'Workstream A', 'TICKET-1005', 'Increase minimum service replicas', 'Test Env 1, Test Env 2', 'Approved', 'Not assigned'],
      ['ITEM-012', 'Release 1', 'Component B', 'Workstream B', 'TICKET-1008', 'Rotate service certificates', 'Test Env 1', 'Certified, release note pending', 'RN-104'],
      ['ITEM-013', 'Release 2', 'Component B', 'Workstream B', 'TICKET-1009', 'Tune cache eviction policy', 'Test Env 2', 'Created', 'Not assigned']
    ],
    template: {
      title: 'Release Tracking Dashboard',
      searchHint: 'Search item, ticket, or description…',
      accentField: 'status',
      fields: [
        { id: 'item_id', source: 'Item ID', label: 'Item ID', type: 'text', show: true, filter: false, chart: false },
        { id: 'release', source: 'Release', label: 'Release', type: 'badge', show: true, filter: true, chart: true },
        { id: 'component', source: 'Component', label: 'Component', type: 'badge', show: true, filter: true, chart: false },
        { id: 'workstream', source: 'Workstream', label: 'Workstream', type: 'badge', show: true, filter: true, chart: false },
        { id: 'ticket', source: 'Ticket', label: 'Ticket', type: 'text', show: true, filter: false, chart: false },
        { id: 'description', source: 'Description', label: 'Description', type: 'longtext', show: true, filter: false, chart: false },
        { id: 'environment', source: 'Environment', label: 'Environment', type: 'tags', show: true, filter: true, chart: true },
        { id: 'status', source: 'Status', label: 'Status', type: 'status', show: true, filter: true, chart: true },
        { id: 'release_note', source: 'Release Note', label: 'Release Note', type: 'text', show: true, filter: false, chart: false }
      ],
      stats: [
        { label: 'Pending release note', field: 'status', value: 'release note pending' },
        { label: 'Approved', field: 'status', value: 'Approved' },
        { label: 'Ready for deployment', field: 'status', value: 'ready to deploy' }
      ]
    }
  },

  {
    id: 'students',
    name: 'Student Records',
    description: 'Students with major, year, GPA, advisor and enrolment status.',
    headers: ['Student', 'Student ID', 'Major', 'Year', 'GPA', 'Advisor', 'Status'],
    rows: [
      ['Avery Cohen', 'S-1001', 'Computer Science', 'Senior', '3.82', 'Dr. Patel', 'Active'],
      ['Noa Mizrahi', 'S-1002', 'Biology', 'Junior', '3.45', 'Dr. Green', 'Active'],
      ['Liam Brooks', 'S-1003', 'Mathematics', 'Sophomore', '2.31', 'Dr. Ortiz', 'On Probation'],
      ['Maya Shapiro', 'S-1004', 'Computer Science', 'Freshman', '3.67', 'Dr. Patel', 'Active'],
      ['Ethan Rivera', 'S-1005', 'Psychology', 'Senior', '3.91', 'Dr. Kim', 'Graduated'],
      ['Yael Friedman', 'S-1006', 'Biology', 'Sophomore', '3.12', 'Dr. Green', 'Active'],
      ['Jordan Lee', 'S-1007', 'Business', 'Junior', '2.05', 'Dr. Adams', 'On Probation'],
      ['Tamar Katz', 'S-1008', 'Mathematics', 'Senior', '3.74', 'Dr. Ortiz', 'Graduated'],
      ['Omar Haddad', 'S-1009', 'Computer Science', 'Junior', '3.28', 'Dr. Patel', 'On Leave'],
      ['Sofia Russo', 'S-1010', 'Psychology', 'Freshman', '3.55', 'Dr. Kim', 'Active'],
      ['Daniel Ben-David', 'S-1011', 'Business', 'Sophomore', '2.89', 'Dr. Adams', 'Active'],
      ['Emma Novak', 'S-1012', 'Biology', 'Freshman', '3.96', 'Dr. Green', 'Active']
    ],
    template: {
      title: 'Student Records',
      searchHint: 'Search student, ID or advisor…',
      accentField: 'status',
      fields: [
        { id: 'student', source: 'Student', label: 'Student', type: 'text', show: true, filter: false, chart: false },
        { id: 'student_id', source: 'Student ID', label: 'Student ID', type: 'text', show: true, filter: false, chart: false },
        { id: 'major', source: 'Major', label: 'Major', type: 'badge', show: true, filter: true, chart: true },
        { id: 'year', source: 'Year', label: 'Year', type: 'badge', show: true, filter: true, chart: true },
        { id: 'gpa', source: 'GPA', label: 'GPA', type: 'number', show: true, filter: false, chart: false },
        { id: 'advisor', source: 'Advisor', label: 'Advisor', type: 'text', show: true, filter: false, chart: false },
        { id: 'status', source: 'Status', label: 'Status', type: 'status', show: true, filter: true, chart: true }
      ],
      stats: [
        { label: 'Active', field: 'status', value: 'Active' },
        { label: 'On probation', field: 'status', value: 'On Probation' },
        { label: 'Graduated', field: 'status', value: 'Graduated' }
      ],
      colors: { status: { Active: '#0ca30c', 'On Probation': '#d03b3b', Graduated: '#2a78d6', 'On Leave': '#898781' } },
      valueOrder: {
        year: ['Freshman', 'Sophomore', 'Junior', 'Senior'],
        status: ['Active', 'On Leave', 'On Probation', 'Graduated']
      }
    }
  },

  {
    id: 'tasks',
    name: 'Project Tasks',
    description: 'A simple task board: owners, priorities, due dates and progress.',
    headers: ['Task', 'Owner', 'Priority', 'Due Date', 'Status', 'Tags'],
    rows: [
      ['Define project scope', 'Dana', 'High', '2026-10-06', 'Done', 'Planning'],
      ['Design database schema', 'Avi', 'High', '2026-10-09', 'In Progress', 'Backend, Design'],
      ['Create login page', 'Noa', 'Medium', '2026-10-12', 'In Review', 'Frontend'],
      ['Set up CI pipeline', 'Avi', 'Medium', '2026-10-13', 'To Do', 'DevOps'],
      ['Write API documentation', 'Dana', 'Low', '2026-10-20', 'To Do', 'Docs'],
      ['Payment integration', 'Eli', 'High', '2026-10-15', 'Blocked', 'Backend'],
      ['Mobile layout fixes', 'Noa', 'Medium', '2026-10-11', 'In Progress', 'Frontend, Design'],
      ['User testing session', 'Dana', 'Medium', '2026-10-18', 'To Do', 'Research'],
      ['Performance audit', 'Eli', 'Low', '2026-10-25', 'To Do', 'Backend'],
      ['Release v1.0', 'Avi', 'High', '2026-10-30', 'To Do', 'Planning, DevOps']
    ],
    template: {
      title: 'Project Tasks',
      searchHint: 'Search task or owner…',
      accentField: 'status',
      fields: [
        { id: 'task', source: 'Task', label: 'Task', type: 'text', show: true, filter: false, chart: false },
        { id: 'owner', source: 'Owner', label: 'Owner', type: 'badge', show: true, filter: true, chart: true },
        { id: 'priority', source: 'Priority', label: 'Priority', type: 'badge', show: true, filter: true, chart: false },
        { id: 'due_date', source: 'Due Date', label: 'Due Date', type: 'date', show: true, filter: false, chart: false },
        { id: 'status', source: 'Status', label: 'Status', type: 'status', show: true, filter: true, chart: true },
        { id: 'tags', source: 'Tags', label: 'Tags', type: 'tags', show: true, filter: true, chart: false }
      ],
      stats: [
        { label: 'In progress', field: 'status', value: 'In Progress' },
        { label: 'Blocked', field: 'status', value: 'Blocked' },
        { label: 'Done', field: 'status', value: 'Done' }
      ],
      colors: { priority: { High: '#d03b3b', Medium: '#fab219', Low: '#898781' } },
      valueOrder: {
        priority: ['High', 'Medium', 'Low'],
        status: ['To Do', 'In Progress', 'In Review', 'Blocked', 'Done']
      }
    }
  },

  {
    id: 'sales',
    name: 'Sales Pipeline',
    description: 'Deals by stage, owner and region, with deal values and close dates.',
    headers: ['Company', 'Contact', 'Stage', 'Deal Value', 'Owner', 'Region', 'Close Date'],
    rows: [
      ['Northwind Ltd', 'R. Adler', 'Lead', '12000', 'Maya', 'North', '2026-11-15'],
      ['Blue Harbor', 'S. Kaplan', 'Qualified', '28000', 'Omer', 'Center', '2026-11-02'],
      ['Cedar Systems', 'L. Moran', 'Proposal', '45000', 'Maya', 'South', '2026-10-28'],
      ['Orbit Foods', 'J. Weiss', 'Negotiation', '67000', 'Tal', 'Center', '2026-10-20'],
      ['Pinecrest Labs', 'D. Shani', 'Won', '38000', 'Omer', 'North', '2026-10-01'],
      ['Atlas Retail', 'M. Levy', 'Lost', '22000', 'Tal', 'South', '2026-09-24'],
      ['Silverline Co', 'A. Peretz', 'Proposal', '51000', 'Tal', 'North', '2026-11-08'],
      ['Greenway Energy', 'K. Amir', 'Qualified', '33000', 'Maya', 'Center', '2026-11-20'],
      ['Harbor Logistics', 'N. Golan', 'Won', '74000', 'Maya', 'South', '2026-09-30'],
      ['Summit Health', 'E. Bar', 'Lead', '15000', 'Omer', 'South', '2026-12-05']
    ],
    template: {
      title: 'Sales Pipeline',
      searchHint: 'Search company or contact…',
      accentField: 'stage',
      fields: [
        { id: 'company', source: 'Company', label: 'Company', type: 'text', show: true, filter: false, chart: false },
        { id: 'contact', source: 'Contact', label: 'Contact', type: 'text', show: true, filter: false, chart: false },
        { id: 'stage', source: 'Stage', label: 'Stage', type: 'status', show: true, filter: true, chart: true },
        { id: 'deal_value', source: 'Deal Value', label: 'Deal Value', type: 'number', show: true, filter: false, chart: false },
        { id: 'owner', source: 'Owner', label: 'Owner', type: 'badge', show: true, filter: true, chart: true },
        { id: 'region', source: 'Region', label: 'Region', type: 'badge', show: true, filter: true, chart: true },
        { id: 'close_date', source: 'Close Date', label: 'Close Date', type: 'date', show: true, filter: false, chart: false }
      ],
      stats: [
        { label: 'In negotiation', field: 'stage', value: 'Negotiation' },
        { label: 'Won', field: 'stage', value: 'Won' },
        { label: 'Lost', field: 'stage', value: 'Lost' }
      ],
      colors: { stage: { Lead: '#898781', Qualified: '#2a78d6', Proposal: '#7c5cd6', Negotiation: '#fab219', Won: '#0ca30c', Lost: '#d03b3b' } },
      valueOrder: { stage: ['Lead', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'] }
    }
  },

  {
    id: 'inventory',
    name: 'Inventory',
    description: 'Stock levels by category and location, with low-stock alerts.',
    headers: ['Item', 'SKU', 'Category', 'Quantity', 'Location', 'Stock Status'],
    rows: [
      ['Wireless Mouse', 'SKU-1001', 'Electronics', '120', 'Warehouse A', 'In Stock'],
      ['USB-C Cable 1m', 'SKU-1002', 'Electronics', '18', 'Warehouse A', 'Low Stock'],
      ['Office Chair', 'SKU-2001', 'Furniture', '0', 'Warehouse B', 'Out of Stock'],
      ['Standing Desk', 'SKU-2002', 'Furniture', '7', 'Warehouse B', 'Low Stock'],
      ['A4 Paper (box)', 'SKU-3001', 'Stationery', '240', 'Store Room', 'In Stock'],
      ['Gel Pens (pack)', 'SKU-3002', 'Stationery', '95', 'Store Room', 'In Stock'],
      ['Monitor 27"', 'SKU-1003', 'Electronics', '0', 'Warehouse A', 'Out of Stock'],
      ['Desk Lamp', 'SKU-2003', 'Furniture', '42', 'Warehouse B', 'In Stock'],
      ['Old Keyboard Model', 'SKU-1004', 'Electronics', '3', 'Warehouse A', 'Discontinued'],
      ['Whiteboard Markers', 'SKU-3003', 'Stationery', '12', 'Store Room', 'Low Stock']
    ],
    template: {
      title: 'Inventory',
      searchHint: 'Search item or SKU…',
      accentField: 'stock_status',
      fields: [
        { id: 'item', source: 'Item', label: 'Item', type: 'text', show: true, filter: false, chart: false },
        { id: 'sku', source: 'SKU', label: 'SKU', type: 'text', show: true, filter: false, chart: false },
        { id: 'category', source: 'Category', label: 'Category', type: 'badge', show: true, filter: true, chart: true },
        { id: 'quantity', source: 'Quantity', label: 'Quantity', type: 'number', show: true, filter: false, chart: false },
        { id: 'location', source: 'Location', label: 'Location', type: 'badge', show: true, filter: true, chart: true },
        { id: 'stock_status', source: 'Stock Status', label: 'Stock Status', type: 'status', show: true, filter: true, chart: true }
      ],
      stats: [
        { label: 'Low stock', field: 'stock_status', value: 'Low Stock' },
        { label: 'Out of stock', field: 'stock_status', value: 'Out of Stock' }
      ],
      colors: { stock_status: { 'In Stock': '#0ca30c', 'Low Stock': '#fab219', 'Out of Stock': '#d03b3b', Discontinued: '#898781' } },
      valueOrder: { stock_status: ['In Stock', 'Low Stock', 'Out of Stock', 'Discontinued'] }
    }
  }
];

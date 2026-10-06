// Sample "Release Tracking" data + template (mirrors the original template screenshot).
window.SAMPLE = {
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
};

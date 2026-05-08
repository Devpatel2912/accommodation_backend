import fs from 'fs';

const filePath = 'd:/AVD/Accommodation_FB/accommodation_backend/routes/admin.js';
let content = fs.readFileSync(filePath, 'utf8');

// Fix 1: Requests soft-delete
content = content.replace(
  /\.update\(\{ status: 'DELETED' \}\)/g,
  ".update({ status: 'CANCELLED', notes: `[DELETED] \${request.notes || ''}`.trim() })"
);

// Fix 2: Users list filter
content = content.replace(
  /\.neq\("role", "DELETED"\)/g,
  ""
);

// Fix 3: Users soft-delete
content = content.replace(
  /\.update\(\{ role: 'DELETED' \}\)/g,
  ".update({ role: null })"
);

fs.writeFileSync(filePath, content);
console.log("Successfully patched admin.js");

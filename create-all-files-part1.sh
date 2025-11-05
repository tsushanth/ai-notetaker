#!/bin/bash
# Part 1: Root configuration files

cd ai-notetaker-backend

echo "Creating root configuration files..."

# .dockerignore
cat > .dockerignore << 'EOF'
node_modules
npm-debug.log
.env
.env.local
.git
.gitignore
README.md
.DS_Store
*.log
.vscode
.idea
coverage
.nyc_output
dist
build
EOF

# .gitignore  
cat > .gitignore << 'EOF'
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Environment variables
.env
.env.local
.env.production

# OS files
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# Logs
logs/
*.log

# Test coverage
coverage/
.nyc_output/

# Build files
dist/
build/

# Temporary files
tmp/
temp/
*.tmp

# Uploaded files (for local dev)
uploads/
EOF

echo "✅ Part 1 complete"

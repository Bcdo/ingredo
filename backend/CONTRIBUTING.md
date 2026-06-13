# 🤝 Contributing to REST API Template

Thank you for your interest in contributing to this Modern C# REST API Template! This guide will help you set up your development environment and understand the contribution process.

## 🚀 Development Setup

### Prerequisites

- .NET 9 SDK
- Docker (optional, for containerization testing)
- Git
- Code editor (VS Code, Visual Studio, or Neovim recommended)

### Setting Up for Development

1. **Fork and Clone:**
   ```bash
   git clone https://github.com/yourusername/rest-api-template
   cd rest-api-template
   ```

2. **Install Dependencies:**
   ```bash
   dotnet restore
   ```

3. **Build and Test:**
   ```bash
   dotnet build
   dotnet test
   dotnet run
   ```

4. **Verify Setup:**
   - API Documentation: https://localhost:7046/scalar/v1
   - Health Check: https://localhost:7046/health
   - Test Endpoint: https://localhost:7046/api/v1.0/Users

## 🏗️ Template Development

### Project Structure for Template Development

When working on the template itself (not using it), you're working with:

```
RestApiProject/              # This becomes the template output
├── Controllers/             # Template controllers
├── Data/                   # Template database context
├── DTOs/                   # Template DTOs
├── Features/               # Template CQRS structure
├── Models/                 # Template domain models
├── Docs/                   # Template documentation
├── .template.config/       # Template configuration
│   └── template.json       # .NET template metadata
└── RestApiProject.csproj   # Template project file
```

### Making Changes to the Template

1. **Modify Source Code:** Change files in the main directory
2. **Update Documentation:** Update files in `Docs/` folder
3. **Test Template Generation:** 
   ```bash
   # Test the template locally
   dotnet new install .
   mkdir test-output
   cd test-output
   dotnet new rest-api-template -n TestProject
   cd TestProject
   dotnet build
   dotnet run
   ```

4. **Update Template Metadata:** Modify `.template.config/template.json` if needed

## 🔧 Development Workflow

### Branch Strategy

- `main` - Production-ready template
- `develop` - Integration branch for new features
- `feature/*` - New template features or improvements
- `docs/*` - Documentation updates
- `fix/*` - Bug fixes

### Commit Messages

Follow conventional commits:
- `feat(template): add new feature to template`
- `fix(template): fix issue in generated code`
- `docs: update usage documentation`
- `chore: update dependencies`

### Example: Adding a New Template Feature

```bash
# Create feature branch
git checkout -b feature/add-jwt-auth-template

# Make changes to the template
# (modify controllers, add new features, etc.)

# Test the template
dotnet new install .
mkdir test-jwt
cd test-jwt
dotnet new rest-api-template -n JwtTest
cd JwtTest
dotnet build && dotnet run

# Commit changes
git add .
git commit -m "feat(template): add JWT authentication template support"

# Push and create PR
git push origin feature/add-jwt-auth-template
```

## 📝 Documentation Updates

### Updating Documentation

When updating documentation:

1. **Template Usage:** Update `Docs/TEMPLATE_USAGE_GUIDE.md`
2. **Features:** Update `Docs/MODERN_FEATURES.md`
3. **Examples:** Update example files in `Docs/`
4. **README:** Update main `README.md` if needed

### Documentation Guidelines

- Use clear, actionable language
- Include code examples for new features
- Update version information when applicable
- Test all code examples before committing

## 🧪 Testing

### Template Testing Checklist

Before submitting changes:

- [ ] Template installs correctly: `dotnet new install .`
- [ ] Template generates project: `dotnet new rest-api-template -n TestProject`
- [ ] Generated project builds: `dotnet build`
- [ ] Generated project runs: `dotnet run`
- [ ] All endpoints work in generated project
- [ ] Docker build works: `docker build -t test .`
- [ ] Documentation is accurate

### Automated Testing

```bash
# Run template tests
./test-template.sh

# Build and test generated project
dotnet build --configuration Release
dotnet test --configuration Release
```

## 🎯 Contribution Areas

### High Priority Areas

1. **Template Features:**
   - Authentication/Authorization improvements
   - Additional entity examples
   - Performance optimizations
   - Security enhancements

2. **Documentation:**
   - More practical examples
   - Video tutorials
   - Better getting-started guides
   - API documentation

3. **Developer Experience:**
   - Better code snippets
   - IDE templates
   - Scaffolding tools

### Medium Priority Areas

1. **Infrastructure:**
   - CI/CD improvements
   - Docker optimizations
   - Cloud deployment templates

2. **Testing:**
   - More comprehensive test coverage
   - Integration test examples
   - Load testing examples

## 📋 Pull Request Guidelines

### Before Submitting

1. **Test Thoroughly:** Ensure template works in multiple scenarios
2. **Update Documentation:** Update relevant docs
3. **Follow Conventions:** Match existing code style and patterns
4. **Add Examples:** Provide usage examples for new features

### PR Description Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Breaking change

## Testing
- [ ] Template installs correctly
- [ ] Generated project builds and runs
- [ ] All examples work
- [ ] Documentation updated

## Checklist
- [ ] Code follows project conventions
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] Template tested end-to-end
```

## 🐛 Bug Reports

### Reporting Issues

1. **Search Existing Issues:** Check if the issue exists
2. **Use Template:** Fill out the issue template
3. **Provide Details:**
   - .NET version
   - Operating system
   - Steps to reproduce
   - Expected vs actual behavior

### Bug Fix Process

1. Create issue (if not exists)
2. Create `fix/issue-number-description` branch
3. Fix the issue
4. Test thoroughly
5. Submit PR referencing the issue

## 🎉 Recognition

Contributors will be:
- Listed in CONTRIBUTORS.md
- Mentioned in release notes
- Credited in documentation

## 📞 Getting Help

- **GitHub Issues:** For bugs and feature requests
- **Discussions:** For questions and ideas
- **Discord/Slack:** [If applicable] For real-time chat

Thank you for contributing! 🚀
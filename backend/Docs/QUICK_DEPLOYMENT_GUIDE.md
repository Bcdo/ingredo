# 🚀 Quick Deployment Guide - Your Modern .NET API

## 🐳 **Option 1: Docker (Recommended for Development)**

### **Build and Run with Docker Compose**
```bash
# Build and start all services
docker-compose up --build -d

# Your API will be available at:
# - Direct: http://localhost:8080
# - Via Nginx: http://localhost (with rate limiting and security headers)

# View logs
docker-compose logs -f api

# Stop services
docker-compose down

# Stop and remove volumes (clean restart)
docker-compose down -v
```

### **Build Docker Image Only**
```bash
# Build the Docker image
docker build -t my-rest-api:latest .

# Run the container
docker run -d -p 8080:8080 --name my-api my-rest-api:latest

# Check if it's running
curl http://localhost:8080/health
```

---

## ☁️ **Option 2: Cloud Deployment (Production)**

### **Heroku (Simplest)**
```bash
# Install Heroku CLI
# Create Dockerfile (already done ✅)

# Login and create app
heroku login
heroku create your-unique-api-name

# Set environment variables
heroku config:set ASPNETCORE_ENVIRONMENT=Production

# Deploy
git add .
git commit -m "Deploy to Heroku"
git push heroku main

# Your API: https://your-unique-api-name.herokuapp.com
```

### **DigitalOcean App Platform**
```bash
# 1. Push your code to GitHub
git remote add origin https://github.com/yourusername/your-repo
git push -u origin main

# 2. Create app via DO dashboard or CLI
doctl apps create app.yaml

# app.yaml:
name: rest-api-app
services:
- name: api
  source_dir: /
  github:
    repo: yourusername/your-repo
    branch: main
  run_command: dotnet RestApiProject.dll
  environment_slug: docker
  instance_count: 1
  instance_size_slug: basic-xxs
  env:
  - key: ASPNETCORE_ENVIRONMENT
    value: Production
```

### **Azure Container Apps (Microsoft)**
```bash
# Install Azure CLI
# Login
az login

# Create resource group
az group create --name MyApiResourceGroup --location eastus

# Create container app environment
az containerapp env create \
  --name my-api-env \
  --resource-group MyApiResourceGroup \
  --location eastus

# Deploy container app
az containerapp create \
  --name my-rest-api \
  --resource-group MyApiResourceGroup \
  --environment my-api-env \
  --image your-dockerhub-username/my-rest-api:latest \
  --target-port 8080 \
  --ingress external \
  --env-vars ASPNETCORE_ENVIRONMENT=Production
```

---

## 🖥️ **Option 3: Traditional Linux VPS**

### **Setup on Ubuntu/Debian**
```bash
# Install .NET 9 runtime
wget https://packages.microsoft.com/config/ubuntu/22.04/packages-microsoft-prod.deb -O packages-microsoft-prod.deb
sudo dpkg -i packages-microsoft-prod.deb
sudo apt update
sudo apt install -y aspnetcore-runtime-9.0

# Install Nginx
sudo apt install nginx

# Upload your published app
# (Build locally: dotnet publish -c Release -o publish)
sudo mkdir -p /var/www/myapi
sudo cp -r publish/* /var/www/myapi/
sudo chown -R www-data:www-data /var/www/myapi

# Create systemd service
sudo tee /etc/systemd/system/myapi.service > /dev/null <<EOF
[Unit]
Description=My .NET API
After=network.target

[Service]
Type=notify
User=www-data
WorkingDirectory=/var/www/myapi
ExecStart=/usr/bin/dotnet RestApiProject.dll
Restart=always
RestartSec=10
KillSignal=SIGINT
SyslogIdentifier=myapi
Environment=ASPNETCORE_ENVIRONMENT=Production
Environment=ASPNETCORE_URLS=http://localhost:5000

[Install]
WantedBy=multi-user.target
EOF

# Start the service
sudo systemctl daemon-reload
sudo systemctl enable myapi
sudo systemctl start myapi

# Configure Nginx
sudo tee /etc/nginx/sites-available/myapi > /dev/null <<EOF
server {
    listen 80;
    server_name yourdomain.com;
    
    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection keep-alive;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

# Enable site
sudo ln -s /etc/nginx/sites-available/myapi /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 🎯 **Recommendations by Use Case**

### **👨‍💻 Learning & Development**
```bash
# Use Docker Compose (already configured for you!)
docker-compose up --build
# Pros: Easy, consistent, includes database & caching
# Cost: Free
```

### **🚀 Personal Projects & Demos**
```bash
# Use Heroku
heroku create my-awesome-api
git push heroku main
# Pros: Simple deployment, free tier available
# Cost: $0-7/month
```

### **💼 Professional Projects**
```bash
# Use DigitalOcean App Platform or Azure Container Apps
# Pros: Managed, scalable, professional features
# Cost: $12-25/month
```

### **🏢 Enterprise**
```bash
# Use Kubernetes on major cloud providers
# Pros: Full control, enterprise features, high availability
# Cost: $100+/month
```

---

## ✅ **Quick Test Your Deployment**

### **Health Check**
```bash
curl https://your-domain.com/health
# Expected: {"status":"Healthy"}
```

### **API Documentation**
```bash
# Visit in browser:
https://your-domain.com/scalar/v1
```

### **Test User API**
```bash
# Get users
curl https://your-domain.com/api/v1/users

# Create user
curl -X POST https://your-domain.com/api/v1/users \
  -H "Content-Type: application/json" \
  -d '{
    "userName": "testuser",
    "firstName": "Test",
    "lastName": "User",
    "email": "test@example.com",
    "password": "TestPass123!",
    "phoneNumber": "555-0123",
    "dateOfBirth": "1990-05-15"
  }'
```

---

## 🔐 **Production Security Checklist**

### **Before Going Live:**
- [ ] **Environment Variables** - Store secrets safely
- [ ] **HTTPS** - Enable SSL/TLS certificates
- [ ] **Database** - Use managed database service
- [ ] **Logging** - Configure centralized logging
- [ ] **Monitoring** - Set up health checks and alerts
- [ ] **Backup** - Automated database backups
- [ ] **Rate Limiting** - Prevent API abuse
- [ ] **CORS** - Configure allowed origins
- [ ] **Authentication** - Implement proper auth (JWT)

### **Environment Variables for Production:**
```bash
export ASPNETCORE_ENVIRONMENT=Production
export DATABASE_CONNECTION_STRING="your-db-connection"
export JWT_SECRET_KEY="your-super-secret-key"
export REDIS_CONNECTION_STRING="your-redis-connection"
```

---

## 🎉 **Your API is Production-Ready!**

Your modern .NET API includes:
- ✅ **Clean Architecture** with CQRS
- ✅ **Professional validation** with FluentValidation  
- ✅ **Secure password hashing** with BCrypt
- ✅ **Modern patterns** (DTOs, Result pattern, MediatR)
- ✅ **API documentation** with Scalar
- ✅ **Health checks** for monitoring
- ✅ **Structured logging** with Serilog
- ✅ **Containerization** ready with Docker

Pick your deployment method and get it online! 🚀

**Recommendation**: Start with Docker Compose for development, then move to a cloud service like DigitalOcean App Platform or Azure Container Apps for production.
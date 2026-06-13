# 🌐 Modern Web API Hosting Guide

## 📋 **Hosting Options Overview**

### **1. Development/Local Hosting**

- **Kestrel** (built-in .NET server)
- **IIS Express** (Windows)
- **Docker Desktop** (containerized)

### **2. Cloud Hosting (Most Common)**

- **Azure App Service** (Microsoft's PaaS)
- **AWS Elastic Beanstalk** / **ECS** / **Lambda**
- **Google Cloud Run** / **App Engine**
- **DigitalOcean App Platform**
- **Heroku** (simple deployment)

### **3. Container Orchestration**

- **Kubernetes** (k8s) - industry standard
- **Docker Swarm** - simpler alternative
- **Azure Container Instances**
- **AWS Fargate**

### **4. Traditional Hosting**

- **IIS** (Windows Server)
- **Nginx + Kestrel** (Linux reverse proxy)
- **Apache + Kestrel** (Linux reverse proxy)
- **VPS/Dedicated servers**

---

## 🏢 **Production Hosting Patterns**

### **Pattern 1: Cloud PaaS (Recommended for Most)**

```
Internet → Load Balancer → App Service → Database
         → CDN (static files)
         → Redis Cache
         → Storage (files)
```

**Pros:**

- ✅ Managed infrastructure
- ✅ Auto-scaling
- ✅ Built-in monitoring
- ✅ SSL/TLS included
- ✅ CI/CD integration

**Cons:**

- ❌ Higher cost
- ❌ Vendor lock-in
- ❌ Less control

### **Pattern 2: Containerized (Enterprise)**

```
Internet → Load Balancer → Kubernetes Cluster
                        ├── API Pods (multiple replicas)
                        ├── Database Pod/Service
                        ├── Redis Pod
                        └── Ingress Controller
```

**Pros:**

- ✅ Highly scalable
- ✅ Platform independent
- ✅ Resource efficient
- ✅ Blue-green deployments
- ✅ Auto-healing

**Cons:**

- ❌ Complex setup
- ❌ Requires DevOps expertise
- ❌ Infrastructure management

### **Pattern 3: Serverless (Event-driven)**

```
Internet → API Gateway → Lambda Functions → RDS/DynamoDB
         → CloudFront CDN
         → S3 Storage
```

**Pros:**

- ✅ No server management
- ✅ Pay per request
- ✅ Auto-scaling
- ✅ Zero maintenance

**Cons:**

- ❌ Cold starts
- ❌ Execution time limits
- ❌ Vendor-specific

---

## 🐳 **Docker Containerization (Modern Standard)**

Docker configuration for your API:

### **Dockerfile**

```dockerfile
# Build stage
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /app

# Copy project files
COPY *.csproj ./
RUN dotnet restore

# Copy source code
COPY . ./
RUN dotnet publish -c Release -o out

# Runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runtime
WORKDIR /app

# Copy published app
COPY --from=build /app/out .

# Create non-root user for security
RUN groupadd -r appgroup && useradd -r -g appgroup appuser
RUN chown -R appuser:appgroup /app
USER appuser

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Start application
ENTRYPOINT ["dotnet", "RestApiProject.dll"]
```

### **docker-compose.yml** (Development)

```yaml
version: "3.8"

services:
  api:
    build: .
    ports:
      - "8080:8080"
    environment:
      - ASPNETCORE_ENVIRONMENT=Development
      - ConnectionStrings__DefaultConnection=Server=db;Database=RestApiDb;User=sa;Password=YourPassword123!;
    depends_on:
      - db
      - redis
    networks:
      - api-network

  db:
    image: mcr.microsoft.com/mssql/server:2022-latest
    environment:
      - ACCEPT_EULA=Y
      - SA_PASSWORD=YourPassword123!
    ports:
      - "1433:1433"
    volumes:
      - db_data:/var/opt/mssql
    networks:
      - api-network

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    networks:
      - api-network

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/ssl/certs
    depends_on:
      - api
    networks:
      - api-network

volumes:
  db_data:

networks:
  api-network:
    driver: bridge
```

---

## ☁️ **Cloud Deployment Examples**

### **Azure App Service**

```bash
# Create resource group
az group create --name MyApiResourceGroup --location "East US"

# Create App Service plan
az appservice plan create \
  --name MyApiPlan \
  --resource-group MyApiResourceGroup \
  --sku S1 \
  --is-linux

# Create web app
az webapp create \
  --resource-group MyApiResourceGroup \
  --plan MyApiPlan \
  --name MyUniqueApiApp \
  --runtime "DOTNETCORE:9.0"

# Deploy from Git
az webapp deployment source config \
  --name MyUniqueApiApp \
  --resource-group MyApiResourceGroup \
  --repo-url https://github.com/yourusername/your-repo \
  --branch main

# Configure app settings
az webapp config appsettings set \
  --resource-group MyApiResourceGroup \
  --name MyUniqueApiApp \
  --settings ASPNETCORE_ENVIRONMENT=Production
```

### **AWS Elastic Beanstalk**

```bash
# Install EB CLI
pip install awsebcli

# Initialize Elastic Beanstalk
eb init

# Create environment
eb create production-api --platform "64bit Amazon Linux 2 v2.1.0 running .NET Core"

# Deploy
eb deploy

# Set environment variables
eb setenv ASPNETCORE_ENVIRONMENT=Production
```

### **Google Cloud Run**

```bash
# Build and push to Google Container Registry
gcloud builds submit --tag gcr.io/your-project-id/my-api

# Deploy to Cloud Run
gcloud run deploy my-api \
  --image gcr.io/your-project-id/my-api \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 1Gi \
  --cpu 1 \
  --max-instances 10
```

---

## 🔧 **Linux VPS Setup (Traditional Hosting)**

### **Nginx + Kestrel Setup**

```bash
# Install .NET 9 runtime
sudo apt update
sudo apt install -y dotnet-runtime-9.0

# Install Nginx
sudo apt install nginx

# Create nginx configuration
sudo nano /etc/nginx/sites-available/myapi
```

**Nginx Configuration:**

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection keep-alive;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

**Systemd Service:**

```ini
# /etc/systemd/system/myapi.service
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
Environment=DOTNET_PRINT_TELEMETRY_MESSAGE=false

[Install]
WantedBy=multi-user.target
```

**Enable and start:**

```bash
sudo systemctl enable myapi
sudo systemctl start myapi
sudo systemctl enable nginx
sudo systemctl start nginx

# Enable site
sudo ln -s /etc/nginx/sites-available/myapi /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 🛡️ **Production Configuration**

### **appsettings.Production.json**

```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Warning",
      "Microsoft.AspNetCore": "Warning"
    }
  },
  "ConnectionStrings": {
    "DefaultConnection": "${DATABASE_CONNECTION_STRING}",
    "RedisConnection": "${REDIS_CONNECTION_STRING}"
  },
  "AllowedHosts": "yourdomain.com,www.yourdomain.com",
  "JwtSettings": {
    "SecretKey": "${JWT_SECRET_KEY}",
    "Issuer": "https://yourdomain.com",
    "Audience": "https://yourdomain.com",
    "ExpiryMinutes": 30
  },
  "Cors": {
    "AllowedOrigins": ["https://yourdomain.com", "https://www.yourdomain.com"]
  }
}
```

### **Program.cs Production Enhancements**

**Purpose:** This section shows advanced production configurations that you can add to your `Program.cs` for enterprise-grade hosting. These enhancements provide:
- **Reverse proxy support** (for nginx, load balancers)
- **Security headers** (HSTS, XSS protection)
- **Performance optimizations** (compression, caching)
- **Monitoring integration** (telemetry, health checks)

**Note:** This complements the basic deployment in `QUICK_DEPLOYMENT_GUIDE.md` by adding enterprise-level configuration.

```csharp
var builder = WebApplication.CreateBuilder(args);

// Production optimizations
if (builder.Environment.IsProduction())
{
    builder.Services.Configure<ForwardedHeadersOptions>(options =>
    {
        options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
        options.KnownNetworks.Clear();
        options.KnownProxies.Clear();
    });

    builder.Services.AddHsts(options =>
    {
        options.Preload = true;
        options.IncludeSubDomains = true;
        options.MaxAge = TimeSpan.FromDays(365);
    });
}

// Response compression
builder.Services.AddResponseCompression(opts =>
{
    opts.MimeTypes = ResponseCompressionDefaults.MimeTypes.Concat(
        new[] { "application/json" });
});

// Add memory cache
builder.Services.AddMemoryCache();

// Add distributed cache (Redis)
builder.Services.AddStackExchangeRedisCache(options =>
{
    options.Configuration = builder.Configuration.GetConnectionString("RedisConnection");
});

var app = builder.Build();

// Production middleware
if (app.Environment.IsProduction())
{
    app.UseForwardedHeaders();
    app.UseHsts();
}

app.UseResponseCompression();
app.UseHttpsRedirection();

// Rate limiting
app.UseRateLimiter();

// Security headers
app.Use(async (context, next) =>
{
    context.Response.Headers.Add("X-Content-Type-Options", "nosniff");
    context.Response.Headers.Add("X-Frame-Options", "DENY");
    context.Response.Headers.Add("X-XSS-Protection", "1; mode=block");
    context.Response.Headers.Add("Referrer-Policy", "strict-origin-when-cross-origin");
    await next();
});

app.Run();
```

---

## 📊 **Monitoring & Observability**

### **Application Insights (Azure)**

```csharp
// Program.cs
builder.Services.AddApplicationInsightsTelemetry();

// Custom telemetry
public class UsersController : ControllerBase
{
    private readonly TelemetryClient _telemetryClient;

    public UsersController(TelemetryClient telemetryClient)
    {
        _telemetryClient = telemetryClient;
    }

    [HttpPost]
    public async Task<IActionResult> CreateUser(CreateUserDto dto)
    {
        var stopwatch = Stopwatch.StartNew();

        try
        {
            // Business logic
            var result = await _mediator.Send(new CreateUserCommand(dto));

            // Track success
            _telemetryClient.TrackEvent("UserCreated", new Dictionary<string, string>
            {
                ["Email"] = dto.Email,
                ["Role"] = dto.Role ?? "User"
            });

            return Ok(result);
        }
        catch (Exception ex)
        {
            _telemetryClient.TrackException(ex);
            throw;
        }
        finally
        {
            _telemetryClient.TrackDependency("UserCreation", "CreateUser",
                DateTime.UtcNow.Subtract(TimeSpan.FromMilliseconds(stopwatch.ElapsedMilliseconds)),
                stopwatch.Elapsed, true);
        }
    }
}
```

### **Prometheus + Grafana (Kubernetes)**

```csharp
// Install prometheus-net
// dotnet add package prometheus-net.AspNetCore

// Program.cs
using Prometheus;

builder.Services.AddSingleton<IMetricsLogger, MetricsLogger>();

var app = builder.Build();

// Metrics endpoint
app.UseMetricServer();
app.UseHttpMetrics();

// Custom metrics
public class MetricsLogger : IMetricsLogger
{
    private readonly Counter _requestCounter = Metrics
        .CreateCounter("api_requests_total", "Total API requests", "method", "endpoint");

    private readonly Histogram _requestDuration = Metrics
        .CreateHistogram("api_request_duration_seconds", "API request duration");

    public void LogRequest(string method, string endpoint)
    {
        _requestCounter.WithLabels(method, endpoint).Inc();
    }
}
```

---

## 🚀 **Deployment Strategies**

### **Blue-Green Deployment**

```bash
# Deploy new version to "green" environment
kubectl apply -f green-deployment.yaml

# Test green environment
curl https://green.yourdomain.com/health

# Switch traffic from blue to green
kubectl patch service api-service -p '{"spec":{"selector":{"version":"green"}}}'

# Monitor and rollback if issues
kubectl patch service api-service -p '{"spec":{"selector":{"version":"blue"}}}'
```

### **Canary Deployment**

```yaml
# Istio virtual service for canary
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: api-canary
spec:
  http:
    - match:
        - headers:
            canary:
              exact: "true"
      route:
        - destination:
            host: api-service
            subset: v2
    - route:
        - destination:
            host: api-service
            subset: v1
          weight: 90
        - destination:
            host: api-service
            subset: v2
          weight: 10
```

---

## 🎯 **Hosting Recommendations by Use Case**

### **Startup/Small Project**

- **Heroku** or **DigitalOcean App Platform**
- **Single database** (PostgreSQL/MySQL)
- **Simple CI/CD** with GitHub Actions
- **Cost**: $5-50/month

### **Growing Business**

- **Azure App Service** or **AWS Elastic Beanstalk**
- **Managed database** (Azure SQL/RDS)
- **Redis cache**
- **CDN** for static files
- **Cost**: $100-500/month

### **Enterprise**

- **Kubernetes** (AKS/EKS/GKE)
- **Microservices architecture**
- **Service mesh** (Istio)
- **Multiple environments**
- **Advanced monitoring**
- **Cost**: $1000+/month

---

## 🎉 **Best Practices Summary**

### **✅ Production Checklist**

- [ ] **HTTPS** enabled with valid certificates
- [ ] **Environment variables** for secrets
- [ ] **Database connection pooling**
- [ ] **Logging** configured (structured logging)
- [ ] **Health checks** implemented
- [ ] **Monitoring** and alerting
- [ ] **Load balancing** for high availability
- [ ] **Backup** strategy in place
- [ ] **Security headers** configured
- [ ] **Rate limiting** implemented
- [ ] **CORS** properly configured
- [ ] **Error handling** and user-friendly error pages

### **🔐 Security Essentials**

- **JWT tokens** with short expiry
- **Input validation** on all endpoints
- **SQL injection** prevention (EF Core helps)
- **XSS** protection headers
- **Rate limiting** to prevent abuse
- **HTTPS** everywhere
- **Secrets management** (Key Vault/Secrets Manager)


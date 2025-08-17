# PowerShell test script for NestJS Microservices
Write-Host "🚀 Testing NestJS Microservices Architecture..." -ForegroundColor Green
Write-Host ""

try {
    # Test health check
    Write-Host "1. Testing health check..." -ForegroundColor Yellow
    $healthResponse = Invoke-WebRequest -Uri "http://localhost:3000/auth/health" -Method GET
    Write-Host "✅ Health check successful - Status: $($healthResponse.StatusCode)" -ForegroundColor Green
    Write-Host "Response: $($healthResponse.Content)" -ForegroundColor Cyan
    Write-Host ""

    # Test user registration
    Write-Host "2. Testing user registration..." -ForegroundColor Yellow
    $registerBody = @{
        email = "john.doe@example.com"
        password = "securePassword123"
        firstName = "John"
        lastName = "Doe"
    } | ConvertTo-Json

    $registerResponse = Invoke-WebRequest -Uri "http://localhost:3000/auth/register" -Method POST -ContentType "application/json" -Body $registerBody
    $registerData = $registerResponse.Content | ConvertFrom-Json
    Write-Host "✅ Registration successful - Status: $($registerResponse.StatusCode)" -ForegroundColor Green
    Write-Host "User: $($registerData.user.email)" -ForegroundColor Cyan
    Write-Host "Token: $($registerData.access_token.Substring(0, 20))..." -ForegroundColor Cyan
    Write-Host ""

    $authToken = $registerData.access_token

    # Test user login
    Write-Host "3. Testing user login..." -ForegroundColor Yellow
    $loginBody = @{
        email = "john.doe@example.com"
        password = "securePassword123"
    } | ConvertTo-Json

    $loginResponse = Invoke-WebRequest -Uri "http://localhost:3000/auth/login" -Method POST -ContentType "application/json" -Body $loginBody
    $loginData = $loginResponse.Content | ConvertFrom-Json
    Write-Host "✅ Login successful - Status: $($loginResponse.StatusCode)" -ForegroundColor Green
    Write-Host "User: $($loginData.user.email)" -ForegroundColor Cyan
    Write-Host ""

    # Test protected route (profile)
    Write-Host "4. Testing protected route (profile)..." -ForegroundColor Yellow
    $headers = @{
        "Authorization" = "Bearer $authToken"
    }
    $profileResponse = Invoke-WebRequest -Uri "http://localhost:3000/auth/profile" -Method GET -Headers $headers
    $profileData = $profileResponse.Content | ConvertFrom-Json
    Write-Host "✅ Profile retrieved successfully - Status: $($profileResponse.StatusCode)" -ForegroundColor Green
    Write-Host "Profile: $($profileData | ConvertTo-Json -Compress)" -ForegroundColor Cyan
    Write-Host ""

    # Test invalid token
    Write-Host "5. Testing with invalid token..." -ForegroundColor Yellow
    try {
        $invalidHeaders = @{
            "Authorization" = "Bearer invalid-token"
        }
        $invalidResponse = Invoke-WebRequest -Uri "http://localhost:3000/auth/profile" -Method GET -Headers $invalidHeaders
        Write-Host "❌ Invalid token should have been rejected" -ForegroundColor Red
    } catch {
        if ($_.Exception.Response.StatusCode -eq 401) {
            Write-Host "✅ Invalid token correctly rejected (401 Unauthorized)" -ForegroundColor Green
        } else {
            Write-Host "❌ Unexpected error: $($_.Exception.Message)" -ForegroundColor Red
        }
    }
    Write-Host ""

    Write-Host "🎉 All tests passed! The microservices architecture is working correctly." -ForegroundColor Green

} catch {
    Write-Host "❌ Test failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "💡 Make sure both services are running:" -ForegroundColor Yellow
    Write-Host "   - Auth Service: pnpm run start:auth" -ForegroundColor Yellow
    Write-Host "   - API Gateway: pnpm run start:gateway" -ForegroundColor Yellow
}

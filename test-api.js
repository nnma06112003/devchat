#!/usr/bin/env node

/**
 * Test script for the NestJS Microservices Architecture
 * This script tests the API endpoints to ensure everything is working correctly
 */

const API_BASE_URL = 'http://localhost:3000';

async function testAPI() {
  console.log('🚀 Testing NestJS Microservices Architecture...\n');

  try {
    // Test health check
    console.log('1. Testing health check...');
    const healthResponse = await fetch(`${API_BASE_URL}/auth/health`);
    const healthData = await healthResponse.json();
    console.log('✅ Health check:', healthData);
    console.log('');

    // Test user registration
    console.log('2. Testing user registration...');
    const registerResponse = await fetch(`${API_BASE_URL}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'john.doe@example.com',
        password: 'securePassword123',
        firstName: 'John',
        lastName: 'Doe',
      }),
    });

    if (!registerResponse.ok) {
      const error = await registerResponse.text();
      console.log('❌ Registration failed:', error);
      return;
    }

    const registerData = await registerResponse.json();
    console.log('✅ Registration successful');
    console.log('User:', registerData.user);
    console.log('Token:', registerData.access_token.substring(0, 20) + '...');
    console.log('');

    const authToken = registerData.access_token;

    // Test user login
    console.log('3. Testing user login...');
    const loginResponse = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'john.doe@example.com',
        password: 'securePassword123',
      }),
    });

    if (!loginResponse.ok) {
      const error = await loginResponse.text();
      console.log('❌ Login failed:', error);
      return;
    }

    const loginData = await loginResponse.json();
    console.log('✅ Login successful');
    console.log('User:', loginData.user);
    console.log('Token:', loginData.access_token.substring(0, 20) + '...');
    console.log('');

    // Test protected route (profile)
    console.log('4. Testing protected route (profile)...');
    const profileResponse = await fetch(`${API_BASE_URL}/auth/profile`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    if (!profileResponse.ok) {
      const error = await profileResponse.text();
      console.log('❌ Profile request failed:', error);
      return;
    }

    const profileData = await profileResponse.json();
    console.log('✅ Profile retrieved successfully');
    console.log('Profile:', profileData);
    console.log('');

    // Test invalid token
    console.log('5. Testing with invalid token...');
    const invalidResponse = await fetch(`${API_BASE_URL}/auth/profile`, {
      headers: {
        Authorization: 'Bearer invalid-token',
      },
    });

    if (invalidResponse.status === 401) {
      console.log('✅ Invalid token correctly rejected');
    } else {
      console.log('❌ Invalid token should have been rejected');
    }
    console.log('');

    console.log(
      '🎉 All tests passed! The microservices architecture is working correctly.',
    );
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.log('\n💡 Make sure both services are running:');
    console.log('   - Auth Service: pnpm run start:auth');
    console.log('   - API Gateway: pnpm run start:gateway');
  }
}

// Run the tests
testAPI();

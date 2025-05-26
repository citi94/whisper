// netlify/functions/transcribe.js

// Simple in-memory rate limiting
const attempts = new Map();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

exports.handler = async (event, context) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { password, audio, filename, language } = JSON.parse(event.body);
    
    // Get client IP for rate limiting
    const clientIp = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
    
    // Check rate limit
    const now = Date.now();
    const userAttempts = attempts.get(clientIp) || [];
    const recentAttempts = userAttempts.filter(time => now - time < WINDOW_MS);
    
    if (recentAttempts.length >= MAX_ATTEMPTS) {
      return {
        statusCode: 429,
        body: JSON.stringify({ error: 'Too many attempts. Please try again later.' })
      };
    }

    // Check password (set your password in Netlify environment variables)
    const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD;
    if (password !== ACCESS_PASSWORD) {
      // Record failed attempt
      recentAttempts.push(now);
      attempts.set(clientIp, recentAttempts);
      
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Invalid password' })
      };
    }

    // Get API key from environment variable
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'API key not configured' })
      };
    }

    // Convert base64 to buffer
    const audioBuffer = Buffer.from(audio, 'base64');
    
    // Create form data
    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', audioBuffer, {
      filename: filename,
      contentType: 'audio/aac'
    });
    form.append('model', 'whisper-1');
    
    // Add language if specified
    if (language) {
      form.append('language', language);
    }

    // Call OpenAI API
    const fetch = require('node-fetch');
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        ...form.getHeaders()
      },
      body: form
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'OpenAI API error');
    }

    const result = await response.json();

    return {
      statusCode: 200,
      body: JSON.stringify({ text: result.text })
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
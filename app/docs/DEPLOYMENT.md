# Deployment Guide

This guide covers deploying the Euphoria frontend to Vercel and backend to Render.

## Overview

- **Frontend**: Next.js app deployed on Vercel
- **Backend**: Node.js/Express server with Socket.io deployed on Render
- **Database**: MongoDB (shared between frontend API routes and backend server)

---

## Backend Deployment (Render)

### 1. Create a New Web Service on Render

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click "New +" → "Web Service"
3. Connect your GitHub repository
4. Select the repository and branch

### 2. Configure Build Settings

**Root Directory**: `server` (if deploying from monorepo root, or leave blank if deploying server folder separately)

**Build Command**:
```bash
npm install && npm run build
```

**Start Command**:
```bash
npm run start
```

### 3. Environment Variables

Add these environment variables in Render's dashboard:

```env
# Server Configuration
PORT=10000
# Note: Render automatically sets PORT, but include it as fallback

# CORS - CRITICAL: Set to your Vercel frontend URL
CORS_ORIGIN=https://your-app.vercel.app
# Or if you have multiple origins:
# CORS_ORIGIN=https://your-app.vercel.app,https://www.yourdomain.com

# Price Provider
PRICE_PROVIDER=coinbase
# Options: 'coinbase' or 'binance'

# MongoDB Connection (REQUIRED)
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/database?retryWrites=true&w=majority
# Get this from your MongoDB Atlas dashboard

# Node Environment
NODE_ENV=production
```

**Important Notes**:
- `CORS_ORIGIN` must match your Vercel frontend URL exactly (including `https://`)
- If you have multiple domains, separate them with commas: `https://app1.vercel.app,https://app2.vercel.app`
- `MONGODB_URI` is required - the server will not start without it

### 4. Render Service Settings

- **Instance Type**: Choose based on your needs (Free tier available, but paid tiers recommended for production)
- **Auto-Deploy**: Enable to auto-deploy on git push
- **Health Check Path**: `/health` (optional, but recommended)

### 5. Get Your Server URL

After deployment, Render will provide a URL like:
```
https://your-server-name.onrender.com
```

**Save this URL** - you'll need it for the frontend configuration.

---

## Frontend Deployment (Vercel)

### 1. Connect Repository to Vercel

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click "Add New..." → "Project"
3. Import your GitHub repository
4. Select the repository

### 2. Configure Build Settings

Vercel should auto-detect Next.js, but verify:

- **Framework Preset**: Next.js
- **Root Directory**: `.` (root of the repo)
- **Build Command**: `npm run build` (default)
- **Output Directory**: `.next` (default)
- **Install Command**: `npm install` (default)

### 3. Environment Variables

Add these environment variables in Vercel's dashboard:

```env
# Backend Server URL (REQUIRED)
NEXT_PUBLIC_GAME_SERVER_URL=https://your-server-name.onrender.com
# Replace with your actual Render server URL

# MongoDB Connection (REQUIRED for API routes)
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/database?retryWrites=true&w=majority
# Same as backend - they share the same database

# JWT Secret (if using authentication)
JWT_SECRET=your-secret-key-here
# Generate a secure random string for production

# X403 Service (if using wallet authentication)
X403_API_KEY=your-x403-api-key
X403_API_URL=https://api.x403.io
# Only if you're using X403 wallet authentication service
```

**Important Notes**:
- `NEXT_PUBLIC_*` variables are exposed to the browser
- `NEXT_PUBLIC_GAME_SERVER_URL` must match your Render server URL exactly
- Never commit `.env.local` files to git

### 4. Deploy

1. Click "Deploy"
2. Vercel will build and deploy your app
3. You'll get a URL like: `https://your-app.vercel.app`

---

## Post-Deployment Checklist

### 1. Verify Backend is Running

Visit your Render server health endpoint:
```
https://your-server-name.onrender.com/health
```

You should see:
```json
{
  "status": "ok",
  "uptime": 123.45,
  "clients": 0,
  "price": { ... }
}
```

### 2. Verify Frontend Connection

1. Open your Vercel app in a browser
2. Open browser DevTools → Console
3. Look for: `[Socket] Connected: <socket-id>`
4. If you see connection errors, check:
   - `NEXT_PUBLIC_GAME_SERVER_URL` is set correctly
   - `CORS_ORIGIN` in Render includes your Vercel URL
   - Render server is running (check Render logs)

### 3. Test Game Functionality

- [ ] Price feed is updating
- [ ] Can place bets
- [ ] Balance updates correctly
- [ ] Socket connection is stable
- [ ] Leaderboard loads
- [ ] Chat works (if enabled)

---

## Troubleshooting

### Backend Issues

**Server won't start:**
- Check Render logs for errors
- Verify `MONGODB_URI` is set correctly
- Ensure `PORT` is set (Render auto-sets it, but include as fallback)

**CORS errors:**
- Verify `CORS_ORIGIN` in Render matches your Vercel URL exactly
- Include protocol (`https://`)
- No trailing slashes
- If using custom domain, add both Vercel URL and custom domain

**Socket.io connection fails:**
- Check Render server is running
- Verify WebSocket support (Render supports it)
- Check firewall/network settings

### Frontend Issues

**Can't connect to server:**
- Verify `NEXT_PUBLIC_GAME_SERVER_URL` is set in Vercel
- Check browser console for connection errors
- Ensure backend CORS allows your Vercel domain

**Environment variables not working:**
- `NEXT_PUBLIC_*` variables must be redeployed after changes
- Restart Vercel deployment after adding new env vars
- Clear browser cache

**Build fails:**
- Check Vercel build logs
- Ensure all dependencies are in `package.json`
- Verify Node.js version compatibility

---

## Custom Domain Setup

### Vercel Custom Domain

1. In Vercel dashboard, go to your project → Settings → Domains
2. Add your custom domain
3. Follow DNS configuration instructions
4. Update `CORS_ORIGIN` in Render to include your custom domain

### Render Custom Domain

1. In Render dashboard, go to your service → Settings → Custom Domains
2. Add your custom domain
3. Update DNS records as instructed
4. Update `NEXT_PUBLIC_GAME_SERVER_URL` in Vercel to use custom domain

---

## Environment-Specific Configuration

### Development
```env
# .env.local (local development)
NEXT_PUBLIC_GAME_SERVER_URL=http://localhost:3002
MONGODB_URI=mongodb://localhost:27017/euphoria-dev
```

### Production
```env
# Vercel Environment Variables
NEXT_PUBLIC_GAME_SERVER_URL=https://your-server.onrender.com
MONGODB_URI=mongodb+srv://... (production database)

# Render Environment Variables
CORS_ORIGIN=https://your-app.vercel.app
MONGODB_URI=mongodb+srv://... (same as Vercel)
```

---

## Monitoring & Logs

### Render Logs
- View real-time logs in Render dashboard
- Check for errors, connection issues, or performance problems

### Vercel Logs
- View build logs and runtime logs in Vercel dashboard
- Monitor function execution and errors

### Recommended Monitoring
- Set up uptime monitoring (e.g., UptimeRobot)
- Monitor MongoDB connection health
- Track Socket.io connection counts
- Set up error tracking (e.g., Sentry)

---

## Security Checklist

- [ ] All environment variables are set (no hardcoded secrets)
- [ ] `JWT_SECRET` is a strong random string
- [ ] MongoDB connection string uses authentication
- [ ] CORS is properly configured (only allow your domains)
- [ ] HTTPS is enabled (automatic on Vercel/Render)
- [ ] Admin panel is disabled in production (check `NODE_ENV` checks)

---

## Cost Optimization

### Render
- Free tier available but has limitations (spins down after inactivity)
- Paid tiers recommended for production ($7/month+)
- Consider using Render's "Always On" option for free tier if needed

### Vercel
- Free tier includes generous limits
- Pro tier ($20/month) for custom domains and more features

### MongoDB Atlas
- Free tier (M0) available for development
- Production: Shared clusters start at ~$9/month

---

## Quick Reference

### Backend (Render)
- **Build**: `npm install && npm run build`
- **Start**: `npm run start`
- **Health Check**: `/health`
- **Required Env Vars**: `PORT`, `CORS_ORIGIN`, `MONGODB_URI`, `PRICE_PROVIDER`

### Frontend (Vercel)
- **Build**: `npm run build` (auto-detected)
- **Required Env Vars**: `NEXT_PUBLIC_GAME_SERVER_URL`, `MONGODB_URI`

### Connection Flow
```
Browser → Vercel (Next.js) → Render (Socket.io Server) → MongoDB
         ↓
    API Routes (Next.js) → MongoDB
```

---

## Support

If you encounter issues:
1. Check Render logs for backend errors
2. Check Vercel logs for frontend errors
3. Verify all environment variables are set correctly
4. Test backend health endpoint directly
5. Check browser console for connection errors


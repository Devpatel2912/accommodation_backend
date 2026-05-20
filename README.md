# Accommodation Backend API

Accommodation Management System — RESTful API built with **Express.js** and **Supabase**.

## Project Structure (MVC)

```
accommodation_backend/
├── config/              # Database & service configurations
│   ├── supabase.js      # Supabase client
│   └── firebase.js      # Firebase Admin SDK
├── middlewares/         # Express middleware
│   └── auth.js          # JWT authentication & admin authorization
├── models/              # Database queries (Supabase)
│   ├── userModel.js     # Users table operations
│   ├── requestModel.js  # Requests & request_members operations
│   ├── roomModel.js     # Rooms & room_bookings operations
│   ├── houseModel.js    # Houses & house_bookings operations
│   └── allocationModel.js # Allocations, items & member allocations
├── controllers/         # Business logic & request handling
│   ├── authController.js       # OTP, register, verify, profile
│   ├── requestController.js    # User: create/edit/delete requests
│   ├── adminController.js      # Admin: manage requests & members
│   ├── allocationController.js # Admin: room/house allocations
│   ├── roomController.js       # Rooms & room bookings CRUD
│   ├── houseController.js      # Houses & house bookings CRUD
│   ├── userController.js       # Admin: user management
│   ├── uploadController.js     # File upload handling
│   └── notificationController.js # FCM push notifications
├── routes/              # Route definitions (HTTP endpoints)
│   ├── auth.js          # /auth/*
│   ├── requests.js      # /requests/*
│   ├── admin.js         # /admin/*
│   ├── rooms.js         # /rooms/*
│   ├── houses.js        # /houses/*
│   ├── upload.js        # /upload/*
│   └── notifications.js # /notifications/*
├── utils/               # Shared utilities
│   ├── email.js         # Nodemailer email templates
│   ├── jwt.js           # JWT token helpers
│   ├── pubsub.js        # Supabase real-time notifications
│   └── helpers.js       # Date utilities & status helpers
├── uploads/             # Uploaded files (gitignored)
├── server.js            # App entry point
├── .env                 # Environment variables
└── package.json
```

## Quick Start

```bash
# Install dependencies
npm install

# Run in development mode (with auto-reload)
npm run dev

# Run in production
npm start
```

## Environment Variables

Create a `.env` file with:

```
PORT=5001
JWT_SECRET=your_jwt_secret
EMAIL_USER=your_email
EMAIL_PASS=your_app_password
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_anon_key
```

## API Routes

| Prefix           | Description                    |
|------------------|--------------------------------|
| `/auth`          | Authentication (OTP, Register) |
| `/requests`      | User request management        |
| `/admin`         | Admin panel operations         |
| `/rooms`         | Room availability & CRUD       |
| `/houses`        | House management               |
| `/upload`        | File uploads                   |
| `/notifications` | Push notifications (FCM)       |

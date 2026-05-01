import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true, // Use SSL
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ✅ Send Status Update to User (Enhanced with Allocation Details)
export const sendRequestStatusEmail = async (email, status, notes, details = null) => {
  let allocationHtml = "";

  if (status === "ACCEPTED" && details) {
    allocationHtml = `
      <h3>Allocation Details</h3>
      <p><strong>Check-in:</strong> ${details.check_in}</p>
      <p><strong>Check-out:</strong> ${details.check_out}</p>
      <table border="1" cellpadding="10" style="border-collapse: collapse; width: 100%;">
        <thead>
          <tr style="background-color: #f2f2f2;">
            <th>Member</th>
            <th>Allocation</th>
          </tr>
        </thead>
        <tbody>
          ${details.allocations.map(alloc => `
            <tr>
              <td>${alloc.member_name}</td>
              <td>${alloc.location}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: email,
    subject: `Accommodation Request Update: ${status}`,
    html: `
      <h2>Request Update</h2>
      <p>Your accommodation request has been <strong>${status}</strong>.</p>
      ${notes ? `<p><strong>Admin Notes/Reason:</strong> ${notes}</p>` : ""}
      ${allocationHtml}
      <p style="margin-top: 20px;">Please log in to your dashboard for more details.</p>
    `,
  });
};

// ✅ Send Initial Request Confirmation to User
export const sendRequestConfirmationEmail = async (email, requestData) => {
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: email,
    subject: "Accommodation Request Received",
    html: `
      <h2>Request Received</h2>
      <p>Thank you for submitting your accommodation request.</p>
      <p><strong>Status:</strong> PENDING</p>
      <p><strong>Details:</strong></p>
      <ul>
        <li>Check-in: ${requestData.check_in}</li>
        <li>Check-out: ${requestData.check_out}</li>
        <li>Total People: ${requestData.total_people}</li>
      </ul>
      <p>We will notify you once an admin reviews and processes your request.</p>
    `,
  });
};

// ✅ Send Booking Details to Member (Forwarding)
export const sendMemberBookingEmail = async (email, memberName, details) => {
  const memberRows = details.allMembers.map(m => `
    <tr>
      <td style="padding: 8px; border-bottom: 1px solid #eee;">${m.name}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eee;">${m.contact || "N/A"}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eee;">${m.pradesh || "N/A"}</td>
    </tr>
  `).join("");

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: email,
    subject: "Your Accommodation Booking Details",
    html: `
      <h2>Hello ${memberName},</h2>
      <p>Your booking details have been forwarded. Here is the information for your group:</p>
      
      <div style="background: #f9f9f9; padding: 15px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #ddd;">
        <h3 style="margin-top: 0;">Requester Details</h3>
        <p><strong>Name:</strong> ${details.requesterName}</p>
        <p><strong>Email:</strong> ${details.requesterEmail || "N/A"}</p>
        <p><strong>Phone:</strong> ${details.requesterPhone || "N/A"}</p>
      </div>

      <div style="background: #eef6ff; padding: 15px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #cfe2ff;">
        <h3 style="margin-top: 0;">Booking Details</h3>
        <p><strong>Location:</strong> ${details.location}</p>
        <p><strong>Check-in:</strong> ${details.check_in}</p>
        <p><strong>Check-out:</strong> ${details.check_out}</p>
      </div>

      <div style="background: #fff; padding: 15px; border-radius: 8px; border: 1px solid #ddd;">
        <h3 style="margin-top: 0;">All Members in this Booking</h3>
        <table style="width: 100%; border-collapse: collapse; text-align: left;">
          <thead>
            <tr style="background: #f2f2f2;">
              <th style="padding: 8px; border-bottom: 2px solid #ddd;">Name</th>
              <th style="padding: 8px; border-bottom: 2px solid #ddd;">Contact</th>
              <th style="padding: 8px; border-bottom: 2px solid #ddd;">Pradesh</th>
            </tr>
          </thead>
          <tbody>
            ${memberRows}
          </tbody>
        </table>
      </div>

      <p style="margin-top: 20px;">Have a pleasant stay!</p>
    `,
  });
};

export const sendOtpEmail = async (email, otp) => {
  console.log(`📧 Attempting to send OTP to: ${email}`);
  try {
    const info = await transporter.sendMail({
      from: `"Accommodation App" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Accommodation App - OTP Verification",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>OTP Verification</title>
        </head>
        <body style="margin:0; padding:0; background-color:#0f0f0f; font-family:Arial, sans-serif;">
          <div style="max-width:500px; margin:40px auto; background:#1c1c1c; border-radius:12px; overflow:hidden; box-shadow:0 4px 20px rgba(0,0,0,0.5);">
            <!-- Header -->
            <div style="background:#4a7bd1; padding:20px; text-align:center;">
              <h1 style="margin:0; color:#000; font-size:24px;">Accommodation App</h1>
            </div>
            <!-- Body -->
            <div style="padding:30px; text-align:center; color:#fff;">
              <h2 style="margin-bottom:10px;">OTP Verification</h2>
              <p style="color:#ccc; font-size:16px;">
                Your One-Time Password is:
              </p>
              <!-- OTP BOX -->
              <div style="
                margin:25px 0;
                font-size:32px;
                letter-spacing:10px;
                font-weight:bold;
                color:#6fa8ff;
              ">
                ${otp}
              </div>
              <p style="color:#ccc; font-size:15px;">
                This OTP will expire in <strong>10 minutes</strong>.
              </p>
              <p style="color:#888; font-size:13px; margin-top:20px;">
                If you did not request this OTP, please ignore this email.
              </p>
            </div>
            <!-- Footer -->
            <div style="background:#2a2a2a; padding:15px; text-align:center;">
              <p style="color:#888; font-size:12px; margin:0;">
                © 2026 Accommodation App. All rights reserved.
              </p>
            </div>
          </div>
        </body>
        </html>
      `,
    });
    console.log(`✅ OTP sent successfully: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error(`❌ Error sending OTP to ${email}:`, error);
    throw error;
  }
};
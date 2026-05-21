import nodemailer from "nodemailer";

let _transporter = null;

function getTransporter() {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  }
  return _transporter;
}

const escapeHtml = (value) => (value ?? "N/A").toString()
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const detailLine = (label, value) => {
  if (value === null || value === undefined || value === "") return "";
  return `<p style="margin: 4px 0;"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`;
};

export const sendRequestStatusEmail = async (email, status, notes, details = null) => {
  let allocationHtml = "";
  const displayStatus = status === "ACCEPTED" ? "APPROVED" : status;

  if ((status === "ACCEPTED" || status?.startsWith("APPROVED")) && details) {
    const allocations = Array.isArray(details.allocations) ? details.allocations : [];
    const locationBlocks = (Array.isArray(details.locations) ? details.locations : []).map(location => `
      <div style="background: #fff; border: 1px solid #d9e6ea; border-radius: 8px; padding: 12px; margin: 10px 0;">
        <h4 style="margin: 0 0 8px 0;">${escapeHtml(location.title)}</h4>
        ${detailLine("Type", location.type)}
        ${detailLine("Room Number", location.room_number)}
        ${detailLine("House Owner", location.owner_name)}
        ${detailLine("Contact Number", location.contact_number)}
        ${detailLine("Address", location.address)}
        ${detailLine("Capacity", location.capacity)}
        ${detailLine("Assigned Members", location.assigned_members)}
        ${(location.latitude && location.longitude)
          ? `<p style="margin: 8px 0 0 0;"><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.latitude)},${encodeURIComponent(location.longitude)}" target="_blank" style="color: #006f7c; text-decoration: none;">View Map</a></p>`
          : ""}
      </div>
    `).join("");

    allocationHtml = `
      <h3>Allocation Details</h3>
      <p><strong>Check-in:</strong> ${escapeHtml(details.check_in)}</p>
      <p><strong>Check-out:</strong> ${escapeHtml(details.check_out)}</p>
      ${details.requesterName ? `<p><strong>Requester:</strong> ${escapeHtml(details.requesterName)}</p>` : ""}
      ${details.requesterPhone ? `<p><strong>Requester Phone:</strong> ${escapeHtml(details.requesterPhone)}</p>` : ""}
      ${locationBlocks}
      <table border="1" cellpadding="10" style="border-collapse: collapse; width: 100%; margin-top: 12px;">
        <thead>
          <tr style="background-color: #f2f2f2;">
            <th>Member</th>
            <th>Contact</th>
            <th>Allocation</th>
          </tr>
        </thead>
        <tbody>
          ${allocations.map(alloc => `
            <tr>
              <td>${escapeHtml(alloc.member_name)}</td>
              <td>${escapeHtml(alloc.member_contact)}</td>
              <td>${escapeHtml(alloc.location)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  await getTransporter().sendMail({
    from: process.env.EMAIL_USER,
    to: email,
    subject: `Accommodation Request Update: ${displayStatus}`,
    html: `
      <h2>Request Update</h2>
      <p>Your accommodation request has been <strong>${escapeHtml(displayStatus)}</strong>.</p>
      ${notes ? `<p><strong>Admin Notes/Reason:</strong> ${escapeHtml(notes)}</p>` : ""}
      ${allocationHtml}
      <p style="margin-top: 20px;">Please log in to your dashboard for more details.</p>
    `,
  });
};

export const sendRequestConfirmationEmail = async (email, requestData) => {
  await getTransporter().sendMail({
    from: process.env.EMAIL_USER,
    to: email,
    subject: "Accommodation Request Received",
    html: `
      <h2>Request Received</h2>
      <p>Thank you for submitting your accommodation request.</p>
      <p><strong>Status:</strong> PENDING</p>
      <p><strong>Details:</strong></p>
      <ul>
        <li>Check-in: ${escapeHtml(requestData.check_in)}</li>
        <li>Check-out: ${escapeHtml(requestData.check_out)}</li>
        <li>Total People: ${escapeHtml(requestData.total_people)}</li>
      </ul>
      <p>We will notify you once an admin reviews and processes your request.</p>
    `,
  });
};

export const sendMemberBookingEmail = async (email, memberName, details) => {
  const memberRows = (details.allMembers || []).map(m => `
    <tr>
      <td style="padding: 8px; border-bottom: 1px solid #eee;">${escapeHtml(m.name)}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eee;">${escapeHtml(m.contact)}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eee;">${escapeHtml(m.pradesh)}</td>
    </tr>
  `).join("");

  await getTransporter().sendMail({
    from: process.env.EMAIL_USER,
    to: email,
    subject: "Your Accommodation Booking Details",
    html: `
      <h2>Hello ${escapeHtml(memberName)},</h2>
      <p>Your booking details have been forwarded. Here is the information for your group:</p>

      <div style="background: #f9f9f9; padding: 15px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #ddd;">
        <h3 style="margin-top: 0;">Requester Details</h3>
        <p><strong>Name:</strong> ${escapeHtml(details.requesterName)}</p>
        <p><strong>Email:</strong> ${escapeHtml(details.requesterEmail)}</p>
        <p><strong>Phone:</strong> ${escapeHtml(details.requesterPhone)}</p>
      </div>

      <div style="background: #eef6ff; padding: 15px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #cfe2ff;">
        <h3 style="margin-top: 0;">Booking Details</h3>
        <p><strong>Location:</strong> ${escapeHtml(details.location)}</p>
        <p><strong>Check-in:</strong> ${escapeHtml(details.check_in)}</p>
        <p><strong>Check-out:</strong> ${escapeHtml(details.check_out)}</p>
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
  console.log(`Attempting to send OTP to: ${email}`);
  try {
    const info = await getTransporter().sendMail({
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
            <div style="background:#4a7bd1; padding:20px; text-align:center;">
              <h1 style="margin:0; color:#000; font-size:24px;">Accommodation App</h1>
            </div>
            <div style="padding:30px; text-align:center; color:#fff;">
              <h2 style="margin-bottom:10px;">OTP Verification</h2>
              <p style="color:#ccc; font-size:16px;">Your One-Time Password is:</p>
              <div style="margin:25px 0; font-size:32px; letter-spacing:10px; font-weight:bold; color:#6fa8ff;">${escapeHtml(otp)}</div>
              <p style="color:#ccc; font-size:15px;">This OTP will expire in <strong>10 minutes</strong>.</p>
              <p style="color:#888; font-size:13px; margin-top:20px;">If you did not request this OTP, please ignore this email.</p>
            </div>
            <div style="background:#2a2a2a; padding:15px; text-align:center;">
              <p style="color:#888; font-size:12px; margin:0;">Accommodation App. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    });
    console.log(`OTP sent successfully: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error(`Error sending OTP to ${email}:`, error);
    throw error;
  }
};

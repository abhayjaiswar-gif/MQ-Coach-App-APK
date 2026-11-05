const nodemailer = require("nodemailer");
const { auditAction } = require("./services/userActivityLogger.cjs");

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST || "smtp.gmail.com",
  port: process.env.MAIL_PORT || 587,
  secure: false,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});

const sendTicketAlert = async (
  ticketData,
  recipientEmail = null,
  req = null,
) => {
  const targetEmail =
    recipientEmail || process.env.OPS_EMAIL || "laxman.chalmale@marcosquay.com";

  try {
    if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
      console.log(
        "⚠️ Email credentials not set in .env. Skipping alert email.",
      );
      if (req) {
        await auditAction(req, {
          page: "Helpdesk",
          type: "EMAIL",
          action: `Skipped sending ticket alert email for Ticket #${ticketData.id || ""} (no SMTP credentials configured)`,
        });
      }
      return;
    }

    const mailOptions = {
      from: `"MQ Support Alert" <${process.env.MAIL_FROM || "alert@marcosquay.com"}>`,
      to: targetEmail,
      subject: `New Support Ticket: ${ticketData.subject}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #005daa; border-bottom: 2px solid #005daa; padding-bottom: 10px;">New Support Ticket Raised</h2>
          <p style="margin-top: 20px;"><strong>From:</strong> ${ticketData.name} (${ticketData.email})</p>
          <p><strong>Subject:</strong> ${ticketData.subject}</p>
          ${ticketData.ssgmName ? `<p><strong>Assigned SSGM:</strong> ${ticketData.ssgmName}</p>` : ""}
          <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <strong>Message:</strong><br />
            <p style="white-space: pre-wrap; color: #333;">${ticketData.message}</p>
          </div>
          <p style="font-size: 14px; margin-top: 30px;">
            <a href="http://localhost:5173/Mantis-Vue/helpdesk/tickets" style="background-color: #005daa; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">View Helpdesk Dashboard</a>
          </p>
          <hr style="margin-top: 40px; border: 0; border-top: 1px solid #eee;" />
          <p style="font-size: 11px; color: #aaa;">This is an automated notification from the MQ Helpdesk system.</p>
        </div>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(
      `✅ Ticket Alert Email Sent to ${targetEmail}:`,
      info.messageId,
    );

    if (req) {
      await auditAction(req, {
        page: "Helpdesk",
        type: "EMAIL",
        action: `Sent ticket alert email for Ticket #${ticketData.id || ""} ("${ticketData.subject || ""}") to ${targetEmail} successfully`,
      });
    }

    return info;
  } catch (error) {
    console.error("❌ SEND TICKET ALERT ERROR:", error);
    if (req) {
      await auditAction(req, {
        page: "Helpdesk",
        type: "EMAIL",
        action: `Failed to send ticket alert email for Ticket #${ticketData.id || ""} to ${targetEmail}: ${error.message}`,
      });
    }
  }
};

const sendManagementEscalationEmail = async (ticketData, req = null) => {
  const targetEmail =
    process.env.MANAGEMENT_EMAIL ||
    "rahul.jain@marcosquay.com, rahil@marcosquay.com";

  try {
    if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
      console.log(
        "⚠️ Email credentials not set in .env. Skipping management escalation email.",
      );
      if (req) {
        await auditAction(req, {
          page: "Helpdesk Escalation",
          type: "EMAIL",
          action: `Skipped sending management escalation email for Ticket #${ticketData.id || ""} (no SMTP credentials configured)`,
        });
      }
      return;
    }

    const mailOptions = {
      from: `"MQ Helpdesk Escalation" <${process.env.MAIL_FROM || "alert@marcosquay.com"}>`,
      to: targetEmail,
      subject: `🚨 ESCALATED TO MANAGEMENT: Support Ticket #${ticketData.id} - ${ticketData.subject}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 2px solid #e11d48; border-radius: 10px;">
          <h2 style="color: #e11d48; border-bottom: 2px solid #e11d48; padding-bottom: 10px;">Ticket Escalated to Management</h2>
          <p style="color: #64748b; font-size: 14px;">This support ticket was not resolved by the Operations Head within the SLA window and has been automatically escalated to Management.</p>
          <p style="margin-top: 20px;"><strong>Ticket ID:</strong> #${ticketData.id}</p>
          <p><strong>From:</strong> ${ticketData.name} (${ticketData.email})</p>
          <p><strong>Subject:</strong> ${ticketData.subject}</p>
          <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <strong>Message:</strong><br />
            <p style="white-space: pre-wrap; color: #333;">${ticketData.message}</p>
          </div>
          <p><strong>Current Tier:</strong> 3 (Management Escalation)</p>
          <p style="font-size: 14px; margin-top: 30px;">
            <a href="http://localhost:5173/Mantis-Vue/helpdesk/tickets" style="background-color: #e11d48; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">View Ticket Dashboard</a>
          </p>
          <hr style="margin-top: 40px; border: 0; border-top: 1px solid #eee;" />
          <p style="font-size: 11px; color: #aaa;">This is an automated notification from the MQ Helpdesk system.</p>
        </div>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("✅ Management Escalation Email Sent:", info.messageId);

    if (req) {
      await auditAction(req, {
        page: "Helpdesk Escalation",
        type: "EMAIL",
        action: `Sent management escalation email for Ticket #${ticketData.id || ""} to ${targetEmail} successfully`,
      });
    }

    return info;
  } catch (error) {
    console.error("❌ SEND MANAGEMENT ESCALATION ERROR:", error);
    if (req) {
      await auditAction(req, {
        page: "Helpdesk Escalation",
        type: "EMAIL",
        action: `Failed to send management escalation email for Ticket #${ticketData.id || ""} to ${targetEmail}: ${error.message}`,
      });
    }
  }
};

const sendPreWeeklyPlannerEmail = async ({
  to,
  cc = null,
  schoolName,
  periodName,
  emailTemplate = "weekly_planner",
  pdfBuffer,
  pdfFilename,
  credentials = null,
  extraAttachments = [],
  req = null,
}) => {
  const recipients = Array.isArray(to) ? to.join(", ") : to;
  const ccRecipients = cc
    ? Array.isArray(cc)
      ? cc.join(", ")
      : cc
    : undefined;

  try {
    // Dynamic transporter using the assigned SSGM's saved Email Address + App Password.
    // Falls back to the global transporter only when no SSGM credentials are provided.
    let activeTransporter = transporter;
    let fromEmail = process.env.MAIL_FROM || "info@marcosquay.com";

    if (credentials && credentials.email && credentials.password) {
      activeTransporter = nodemailer.createTransport({
        host: process.env.MAIL_HOST || "smtp.gmail.com",
        port: process.env.MAIL_PORT || 587,
        secure: false,
        auth: {
          user: credentials.email,
          pass: credentials.password,
        },
      });
      fromEmail = credentials.email;
    } else if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
      console.log(
        "⚠️ Email credentials not set in .env. Skipping Pre-Weekly Planner email.",
      );
      if (req) {
        await auditAction(req, {
          page: "Pre-Weekly Planner",
          type: "EMAIL",
          action: `Skipped sending Pre-Weekly Planner email for ${schoolName} to ${recipients} (no SMTP credentials configured)`,
        });
      }
      return null;
    }

    const mainAttachments = [];
    if (pdfBuffer) {
      mainAttachments.push({
        filename:
          pdfFilename ||
          `Curriculum_Report_${schoolName.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      });
    }
    if (Array.isArray(extraAttachments) && extraAttachments.length > 0) {
      mainAttachments.push(...extraAttachments);
    }

    let html;
    switch (emailTemplate) {
      case "assessment_plan":
        html = `
    <p>Dear Sir/Madam,</p>

    <p>
      Please find attached the <strong>Weekly Curriculum Planner</strong> for
      <strong>${schoolName}</strong>.
    </p>

    <p>
      Please note that the coaches will not be following the regular lesson plan this week.
      Instead, they will be following the <strong>plan provided for the week</strong> to ensure
      that the sessions are conducted as scheduled.
    </p>

    <p>
      If you have any questions or require any clarification, please feel free to contact us.
    </p>

    <p>
      Thank you for your understanding and cooperation.
    </p>

    <p>
      Best regards,<br>
      <strong>Marcos Quay Team</strong>
    </p>

    <hr>
  `;
        break;

      case "custom_assessment_planner":
        html = `
    <p>Dear Sir/Madam,</p>

    <p>
      Please find attached the <strong>Weekly Curriculum Planner</strong> for
      <strong>${schoolName}</strong>.
    </p>

    <p>
      Please note that the coaches will be following the lesson plans as outlined in the planner,
      which include both the <strong>Custom Sports Lesson Plan</strong> and the
      <strong>Current Week's Sports Lesson Plan</strong>, as applicable.
    </p>

    <p>
      If you have any questions or require any clarification, please feel free to contact us.
    </p>

    <p>
      Best regards,<br>
      <strong>Marcos Quay Team</strong>
    </p>

    <hr>
  `;
        break;

      case "weekly_planner":
      default:
        html = `
    <p>Dear Sir/Madam,</p>

    <p>
      Please find attached the <strong>Weekly Curriculum Planner</strong> for
      <strong>${schoolName}</strong>.
    </p>

    <p>
      The attached planner outlines the <strong>lesson plans scheduled for the current week</strong>,
      covering each assigned sport and grade. The coaches will follow the respective lesson plans
      as outlined in the planner to ensure that the sessions are conducted as scheduled.
    </p>

    <p>
      If you have any questions or require any clarification, please feel free to contact us.
    </p>

    <p>
      Best regards,<br>
      <strong>Marcos Quay Team</strong>
    </p>

    <hr>
  `;
        break;
    }

    const mailOptions = {
      from: `"${schoolName}  Weekly Planner" <${fromEmail}>`,
      to: recipients,
      ...(ccRecipients ? { cc: ccRecipients } : {}),
      subject: `This Weekly Curriculum Planner - ${schoolName} (${periodName || "Current Week Lesson Plan"})`,
      html,
      attachments: mainAttachments,
    };

    const info = await activeTransporter.sendMail(mailOptions);
    const ccLog = ccRecipients ? ` CC: ${ccRecipients}` : "";
    console.log(
      `✅ SSGM Pre-Weekly Email sent FROM <${fromEmail}> to ${recipients}${ccLog}:`,
      info.messageId,
    );

    if (req) {
      await auditAction(req, {
        page: "Pre-Weekly Planner",
        type: "EMAIL",
        action: `Sent Weekly Curriculum Planner email for ${schoolName} (${periodName || "Current Week"}) to ${recipients}${ccLog} successfully`,
      });
    }

    return info;
  } catch (error) {
    console.error("❌ SEND PRE-WEEKLY PLANNER EMAIL ERROR:", error);
    if (req) {
      await auditAction(req, {
        page: "Pre-Weekly Planner",
        type: "EMAIL",
        action: `Failed to send Weekly Curriculum Planner email for ${schoolName} (${periodName || "Current Week"}) to ${recipients}: ${error.message}`,
      });
    }
    throw error;
  }
};

const sendStockTransferEmail = async ({
  to,
  fromSchool,
  toSchool,
  equipmentName,
  size,
  month,
  year,
  quantity,
  sourceBefore,
  sourceAfter,
  destinationBefore,
  destinationAfter,
  transferredBy,
  transferredDate,
}) => {
  const sizeLabel =
    size === null || size === undefined || size === "" ? "—" : String(size);

  try {
    if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
      console.log(
        "⚠️ Email credentials not set in .env. Skipping stock transfer email.",
      );
      return null;
    }

    const formattedTransferredDate = transferredDate
      ? new Date(transferredDate).toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          day: "2-digit",
          month: "long",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        })
      : new Date().toLocaleString("en-IN", {
          timeZone: "Asia/Kolkata",
          day: "2-digit",
          month: "long",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        });

    const mailOptions = {
      from: `"MQ Stock Transfer" <${process.env.MAIL_FROM || "info@marcosquay.com"}>`,
      to,
      subject: `School Stock Transfer Completed — ${equipmentName} | ${month} ${year}`,
      html: `      
      <p style="margin-top: 20px;">
      This is to inform you that a <strong>stock transfer of ${equipmentName} (${sizeLabel})</strong> has been successfully completed between <strong>${fromSchool}</strong> and <strong>${toSchool}</strong> for the month of <strong>${month} ${year}</strong>.
      </p>
      
      <p>
      A total quantity of <strong>${quantity} units</strong> has been transferred from <strong>${fromSchool}</strong> to <strong>${toSchool}</strong>. Following the transfer, the available stock at the source school has been updated from <strong>${sourceBefore} units to ${sourceAfter} units</strong>, while the stock at the destination school has increased from <strong>${destinationBefore} units to ${destinationAfter} units</strong>.
      </p>
      
      <p>
      The transfer was successfully processed by <strong>${transferredBy || "—"}</strong> on <strong>${formattedTransferredDate}</strong>.
      </p>
      
      <p>
      This transfer has been recorded successfully in the school inventory system for reference and tracking purposes.
      </p>

      <p>
      Regards,<br>
      <strong>School Inventory Management System</strong>
      </p>
`,
      // html: `
      //   <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
      //     <h2 style="color: #005daa; border-bottom: 2px solid #005daa; padding-bottom: 10px;">School Stock Transfer</h2>
      //     <p style="margin-top: 20px;"><strong>Status:</strong> SUCCESSFUL</p>
      //     <p><strong>From School:</strong> ${fromSchool}</p>
      //     <p><strong>To School:</strong> ${toSchool}</p>
      //     <p><strong>Equipment:</strong> ${equipmentName}</p>
      //     <p><strong>Size:</strong> ${sizeLabel}</p>
      //     <p><strong>Month:</strong> ${month}</p>
      //     <p><strong>Year:</strong> ${year}</p>
      //     <p><strong>Quantity Transferred:</strong> ${quantity}</p>
      //     <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
      //       <strong>SOURCE SCHOOL</strong><br />
      //       <p>Before: ${sourceBefore}</p>
      //       <p>Transferred: ${quantity}</p>
      //       <p>After: ${sourceAfter}</p>
      //     </div>
      //     <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
      //       <strong>DESTINATION SCHOOL</strong><br />
      //       <p>Before: ${destinationBefore}</p>
      //       <p>Added: ${quantity}</p>
      //       <p>After: ${destinationAfter}</p>
      //     </div>
      //     <p><strong>Transferred By:</strong> ${transferredBy || "—"}</p>
      //     <p><strong>Transfer Date:</strong> ${transferredDate || new Date().toLocaleString()}</p>
      //     <hr style="margin-top: 40px; border: 0; border-top: 1px solid #eee;" />
      //     <p style="font-size: 11px; color: #aaa;">This is an automated notification from the MQ school inventory system.</p>
      //   </div>
      // `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Stock Transfer Email Sent to ${to}:`, info.messageId);
    return info;
  } catch (error) {
    console.error("❌ SEND STOCK TRANSFER EMAIL ERROR:", error);
    throw error;
  }
};

const sendSportsLevelCompletionEmail = async ({
  recipientEmails,
  schoolName,
  schoolGrade,
  sport,
  sportsLevel,
  totalLps,
  completedLps,
}) => {
  const targetEmail = Array.isArray(recipientEmails)
    ? recipientEmails.join(", ")
    : recipientEmails;

  try {
    if (!process.env.MAIL_USER || !process.env.MAIL_PASS) {
      console.log(
        "⚠️ Email credentials not set in .env. Skipping completion email.",
      );
      return null;
    }

    const mailOptions = {
      from: `"MQ Curriculum Alert" <${process.env.MAIL_FROM || "alert@marcosquay.com"}>`,
      to: targetEmail,
      subject: `Curriculum Level Completed – ${sport} – ${schoolGrade} – ${sportsLevel}`,
      html: `
  <p>Dear SSGM,</p>

  <p>The following curriculum level has been completed:</p>

  <p><strong>School:</strong> ${schoolName}</p>
  <p><strong>School Grade:</strong> ${schoolGrade}</p>
  <p><strong>Sport:</strong> ${sport}</p>
  <p><strong>Completed Sports Level:</strong> ${sportsLevel}</p>
  <p><strong>Total Lesson Plans:</strong> ${totalLps}</p>
  <p><strong>Completed Lesson Plans:</strong> ${completedLps || totalLps}</p>

  <p>
    The Lesson Plan curriculum for this Sport and Sports Level has been completed.
    Please upgrade to the next level.
  </p>

  <p>Regards,<br>
  MQ Curriculum Management System</p>
`,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(
      `✅ Sports Level Completion Email Sent to ${targetEmail}:`,
      info.messageId,
    );
    return info;
  } catch (error) {
    console.error("❌ SEND SPORTS LEVEL COMPLETION EMAIL ERROR:", error);
    throw error;
  }
};

module.exports = {
  transporter,
  sendTicketAlert,
  sendManagementEscalationEmail,
  sendPreWeeklyPlannerEmail,
  sendStockTransferEmail,
  sendSportsLevelCompletionEmail,
};

const nodemailer = require('nodemailer');
const { logger } = require('../utils/logger');

class AlertService {
  constructor() {
    this.transporter = null;
    this.initialized = false;
  }

  initialize() {
    if (this.initialized) return;

    try {
      this.transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.ALERT_EMAIL_USER || 'puzzleverseai@gmail.com',
          pass: process.env.ALERT_EMAIL_PASS
        }
      });
      this.initialized = true;
      logger.info('Alert service initialized');
    } catch (error) {
      logger.error('Failed to initialize alert service', { error: error.message });
    }
  }

  async sendErrorAlert({ userId, userEmail, flow, error, deviceInfo, timestamp }) {
    if (!this.initialized) {
      this.initialize();
    }

    if (!this.transporter) {
      logger.error('Alert transporter not available');
      return false;
    }

    const subject = `[ScribeAI Alert] User Journey Failed: ${flow}`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc3545;">User Journey Failed</h2>

        <div style="background: #f8f9fa; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
          <h3 style="margin-top: 0; color: #333;">Flow Details</h3>
          <p><strong>Failed Flow:</strong> ${flow}</p>
          <p><strong>Timestamp:</strong> ${timestamp || new Date().toISOString()}</p>
        </div>

        <div style="background: #fff3cd; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
          <h3 style="margin-top: 0; color: #856404;">Error Information</h3>
          <p><strong>Error Message:</strong></p>
          <pre style="background: #f8f9fa; padding: 12px; border-radius: 4px; overflow-x: auto;">${error || 'No error message provided'}</pre>
        </div>

        <div style="background: #e7f3ff; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
          <h3 style="margin-top: 0; color: #0056b3;">User Information</h3>
          <p><strong>User ID:</strong> ${userId || 'Anonymous'}</p>
          <p><strong>User Email:</strong> ${userEmail || 'Not available'}</p>
        </div>

        ${deviceInfo ? `
        <div style="background: #f8f9fa; padding: 16px; border-radius: 8px;">
          <h3 style="margin-top: 0; color: #333;">Device Information</h3>
          <p><strong>Device:</strong> ${deviceInfo.device || 'Unknown'}</p>
          <p><strong>OS Version:</strong> ${deviceInfo.osVersion || 'Unknown'}</p>
          <p><strong>App Version:</strong> ${deviceInfo.appVersion || 'Unknown'}</p>
        </div>
        ` : ''}
      </div>
    `;

    const mailOptions = {
      from: process.env.ALERT_EMAIL_USER || 'puzzleverseai@gmail.com',
      to: process.env.ALERT_EMAIL_USER || 'puzzleverseai@gmail.com',
      subject,
      html
    };

    try {
      await this.transporter.sendMail(mailOptions);
      logger.info('Error alert email sent', { flow, userId });
      return true;
    } catch (error) {
      logger.error('Failed to send error alert email', { error: error.message });
      return false;
    }
  }
}

module.exports = new AlertService();

import nodemailer from "nodemailer";
import dns from "dns";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";

dns.setDefaultResultOrder("ipv4first");

const smtpOptions: SMTPTransport.Options = {
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false,
  },
  logger: true,
  debug: true,
};

const transporter = nodemailer.createTransport(smtpOptions);

export default transporter;
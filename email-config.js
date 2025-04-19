module.exports = {
    SMTP_SERVER: process.env.SMTP_SERVER || 'email-smtp.us-east-1.amazonaws.com',
    SMTP_PORT: process.env.SMTP_PORT || 587,
    SMTP_USER: process.env.SMTP_LOGIN_USER || 'AKIA3VRD44Q6TJQ2AQHG',
    SMTP_PASSWORD: process.env.SMTP_LOGIN_PASSWORD || 'BPU0Ey1qvHE6X4DtitkiHNeFuUuVX+54m9fZI4CLtcNf',
    FROM_EMAIL: process.env.FROM_EMAIL || 'noreply@dhira.io'
};

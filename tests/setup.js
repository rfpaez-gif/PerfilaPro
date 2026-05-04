// Variables de entorno ficticias para que los módulos inicialicen sin errores
process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_mock';
process.env.STRIPE_PRICE_BASE = 'price_base_mock';
process.env.STRIPE_PRICE_PRO  = 'price_pro_mock';
process.env.SUPABASE_URL = 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'mock-service-key';
process.env.RESEND_API_KEY = 're_test_mock';

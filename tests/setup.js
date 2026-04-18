// Variables de entorno ficticias para que los módulos inicialicen sin errores
process.env.STRIPE_SECRET_KEY = 'sk_test_mock';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_mock';
process.env.SUPABASE_URL = 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'mock-service-key';

# AI Justice Assistant 🏛️⚖️

An intelligent legal assistance platform for Pakistan, providing AI-powered legal guidance, case classification, court recommendations, and lawyer matching.

## ✅ PROJECT STATUS: BACKEND & FRONTEND COMPLETE

### Backend ✅ DEPLOYED
All backend infrastructure is deployed and operational!

- ✅ **4 Edge Functions Deployed** - All APIs live and ready
- ✅ **Database Configured** - 7 tables with RLS and optimizations
- ✅ **2,026 Legal Documents** - Processed with embeddings
- ✅ **28 Courts + 105 Lawyers** - Data loaded and indexed

### Frontend ✅ COMPLETE
Full-featured React application ready to use!

- ✅ **Authentication System** - Signup, Login, Email Confirmation
- ✅ **Chat Interface** - AI-powered legal assistant
- ✅ **Progress Tracking** - 3-phase workflow visualization
- ✅ **Phase Cards** - Interactive instruction popups
- ✅ **Mobile Responsive** - Works on all devices
- ✅ **Modern UI** - Glassmorphic design with dark theme

**Project URL**: `https://txctngaadlkztnkqfrtm.supabase.co`

### ⚠️ IMPORTANT: Set Environment Secrets

Before testing, you must set environment secrets in Supabase Dashboard:

**Go to**: https://supabase.com/dashboard/project/txctngaadlkztnkqfrtm/settings/functions

Add these 4 secrets:
- `Groq_API_KEY`
- `Groq_MODEL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

**See [SET_ENVIRONMENT_SECRETS.md](SET_ENVIRONMENT_SECRETS.md) for complete instructions.**

## 🎯 Features

- **RAG-Powered Legal Chatbot**: Ask questions about Pakistani law (Civil, Criminal, Family)
- **Smart Case Classification**: Automatically categorize legal issues
- **Court Recommendations**: Get matched with the right court based on case type and location
- **Lawyer Matching**: Find qualified advocates based on specialization, experience, and ratings
- **Secure Authentication**: User accounts with role-based access (user/admin)

## 🏗️ Architecture

- **Frontend**: React + Vite ✅ COMPLETE
- **Backend**: Supabase Edge Functions (Deno) ✅ DEPLOYED
- **Database**: PostgreSQL with pgvector extension ✅ CONFIGURED
- **AI**: Groq API (Llama models) ✅ INTEGRATED
- **RAG**: LangChain + sentence-transformers ✅ OPERATIONAL
- **Auth**: Supabase Auth with email confirmation ✅ WORKING

## 📋 Prerequisites

Before you begin, ensure you have:

- Node.js (v18+)
- Python (v3.10+)
- Supabase account ✅ CONFIGURED
- Groq API key ✅ CONFIGURED

## 🚀 Quick Start

### 1. Clone and Install

```bash
cd D:\Projects\Ai-Justice-Assistance

# Install Python dependencies
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt

# Install Node dependencies
npm install
```
### 2. Configure Environment

Create `.env` file:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
Groq_API_KEY=your_groq_api_key
Groq_MODEL=llama-3.1-8b-instant
```
```bash
# Process legal PDFs and generate embeddings
python scripts/process_documents.py  # ✅ 2,026 chunks processed

# Load court data
python scripts/load_courts.py  # ✅ 28 courts loaded

# Load lawyer data
python scripts/load_lawyers.py  # ✅ 105 lawyers loaded
```

## 📁 Project Structure

```text
Ai-Justice-Assistance/
├── data/                       # Legal documents and data
│   ├── *.pdf                   # Legal acts and codes
│   ├── sindh_courts.csv        # Court information
│   └── Advocate list.xlsx      # Lawyer data
├── scripts/                    # Data processing scripts
│   ├── process_documents.py    # PDF → Embeddings
│   ├── load_courts.py          # Load court data
│   └── load_lawyers.py         # Load lawyer data
├── supabase/functions/         # Edge Functions (APIs)
│   ├── rag-chat/               # Legal Q&A chatbot
│   ├── classify-case/          # Case classification
│   ├── recommend-court/        # Court matching
│   └── recommend-lawyer/       # Lawyer matching
├── src/                        # React frontend (TBD)
├── database-schema.md          # Database documentation
├── SETUP_GUIDE.md              # Detailed setup instructions
└── README.md                   # This file
```
## 👥 Team
Kaml Mirza

Omama Mahrukh Usmani

Abdullah Iqbal

Final Year Project - AI Justice Assistant

## 📄 License
Educational Project

The AI Justice Assistant is an intelligent, user-centric legal support platform designed to address the significant challenges of inaccessibility and delays in Pakistan's justice system.

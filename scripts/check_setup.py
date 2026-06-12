"""
Quick setup verification script
"""
import os
import sys
from pathlib import Path

def check_env_file():
    """Check if .env file exists and has required variables"""
    env_path = Path(".env")
    if not env_path.exists():
        print("❌ .env file not found")
        print("   Create it from .env.example: copy .env.example .env")
        return False
    
    required_vars = [
        "VITE_SUPABASE_URL",
        "VITE_SUPABASE_ANON_KEY",
        "SUPABASE_SERVICE_ROLE_KEY",
        "Groq_API_KEY"
    ]
    
    with open(env_path) as f:
        content = f.read()
    
    missing = []
    for var in required_vars:
        if var not in content or f"{var}=your_" in content:
            missing.append(var)
    
    if missing:
        print(f"❌ Missing or incomplete environment variables:")
        for var in missing:
            print(f"   - {var}")
        return False
    
    print("✅ .env file configured")
    return True

def check_python_deps():
    """Check if Python dependencies are installed"""
    try:
        import langchain
        import requests
        import supabase
        import pandas
        import sentence_transformers
        print("✅ Python dependencies installed")
        return True
    except ImportError as e:
        print(f"❌ Missing Python dependencies: {e}")
        print("   Run: pip install -r requirements.txt")
        return False

def check_data_files():
    """Check if data files exist"""
    data_dir = Path("data")
    required_files = [
        "sindh_courts.csv",
        "Advocate list.xlsx"
    ]
    
    pdf_files = list(data_dir.glob("*.pdf"))
    
    missing = []
    for file in required_files:
        if not (data_dir / file).exists():
            missing.append(file)
    
    if missing:
        print(f"❌ Missing data files:")
        for file in missing:
            print(f"   - data/{file}")
        return False
    
    print(f"✅ Data files present ({len(pdf_files)} PDFs, CSV, Excel)")
    return True

def main():
    print("\n" + "="*60)
    print("AI JUSTICE ASSISTANT - SETUP VERIFICATION")
    print("="*60 + "\n")
    
    checks = [
        ("Environment Configuration", check_env_file),
        ("Python Dependencies", check_python_deps),
        ("Data Files", check_data_files)
    ]
    
    results = []
    for name, check_func in checks:
        print(f"Checking {name}...")
        results.append(check_func())
        print()
    
    print("="*60)
    if all(results):
        print("✅ ALL CHECKS PASSED!")
        print("\nYou're ready to process data:")
        print("  1. python scripts/process_documents.py")
        print("  2. python scripts/load_courts.py")
        print("  3. python scripts/load_lawyers.py")
    else:
        print("❌ SETUP INCOMPLETE")
        print("\nPlease fix the issues above before proceeding.")
        print("See SETUP_GUIDE.md for detailed instructions.")
    print("="*60 + "\n")

if __name__ == "__main__":
    main()

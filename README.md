# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Prerequisites

This app uses `phockup` to ingest media. Please install it on your system:

### MacOS

### MacOS

The reliable way to install Phockup is to clone the repository and set up a local virtual environment (since it's not a standard package):

```bash
# 1. Clone the repository to a hidden folder in your home directory
git clone https://github.com/ivandokov/phockup.git ~/.phockup

# 2. Enter the directory
cd ~/.phockup

# 3. Create a virtual environment and install dependencies
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 4. Create a symlink to make it executable globally
# (This assumes ~/.local/bin is in your PATH, which pipx likely verified)
mkdir -p ~/.local/bin
ln -s ~/.phockup/phockup.py ~/.local/bin/phockup
```

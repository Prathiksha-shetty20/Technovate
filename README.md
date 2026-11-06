<div align="center">

# 🔵 QueuePulse

### ⏱️ Less waiting. More knowing.

**A smart digital queue platform for customers and service teams.**

<br />

![React](https://img.shields.io/badge/Frontend-React-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Build-Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)
![Python](https://img.shields.io/badge/Language-Python-3776AB?style=for-the-badge&logo=python&logoColor=white)
![SQLite](https://img.shields.io/badge/Database-SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)

</div>

---

## 🌟 What is QueuePulse?

QueuePulse helps customers join a service queue digitally, follow their progress, and see an estimated wait. Staff can manage service queues and counters from a dedicated workspace.

Our goal is to make waiting more predictable for customers and queue activity easier to understand for staff.

## 🎯 The problem

At busy service centers, customers may not know:

- 👥 How many people are ahead of them.
- ⌛ How long the wait might be.
- 🔔 When they are likely to be served.

Staff may also find it difficult to see where queues are building up and which counters are available.

## 💡 Our solution

QueuePulse brings customer queue tracking and staff queue management into one web application. Customers receive digital tokens, while staff can monitor and manage their service area.

## ✨ Features

### 🙋 Customer

- Create an account and sign in.
- Choose **General**, **Accounts**, or **Support**.
- Receive a digital queue token.
- View token status, people ahead, and estimated wait.
- Follow progress as the queue moves.

### 🧑‍💼 Staff

- Sign in and open a service workspace.
- View customers waiting or being served.
- See counter capacity and availability.
- Call the next eligible customer and complete service.
- Request a counter break.
- Review completed service history.

### 📊 Queue insights

- View service activity and performance information.
- Identify busy periods and possible bottlenecks.
- Explore counter-allocation scenarios and recommendations.

> Queue and wait-time insights are prototype estimates based on the data available in the application. They are intended to support staff decisions.

## ⚙️ How it works

1. The customer selects a service and requests a token.
2. QueuePulse adds the token to that service’s queue.
3. The customer checks their token status and estimated wait.
4. Staff manage customers and counters in their service workspace.
5. Completed visits can be recorded for service history and queue insights.

## 🧠 Queue logic

QueuePulse uses simple, explainable rules:

- **First In, First Out (FIFO):** Customers are served in the order they joined.
- **Wait estimate:** Uses queue position, average service duration, and available counters to estimate waiting time.
- **Bottleneck indicators:** Queue workload and counter availability can highlight service areas that may need attention.
- **What-if estimate:** A counter scenario can show the projected effect of assigning another counter.

**This prototype does not use a trained machine-learning model.** Its estimates use rules and available application data.

## 🛠️ Built with

| Tool | Role |
| --- | --- |
| ⚛️ React | Customer and staff interfaces |
| ⚡ Vite | Frontend development server and build tooling |
| 🟨 JavaScript | Frontend behavior and API requests |
| 🐍 Python | Backend queue logic |
| 🚀 FastAPI | HTTP API for frontend and backend communication |
| 🦄 Uvicorn | Runs the FastAPI server |
| 🗃️ SQLite | Local application data storage |
| 🧩 Visual Studio Code | Code editing and project workspace |
| 🌿 Git and GitHub | Version control and collaboration |
| 💻 PowerShell | Running commands and local development servers on Windows |

## 🏗️ How we built it

We built QueuePulse in stages:

1. **Project setup:** Separated the frontend and backend into their own folders.
2. **Backend API:** Added FastAPI endpoints to handle service and queue operations.
3. **Data storage:** Used SQLite to store application records locally.
4. **Frontend screens:** Built customer and staff interfaces with React.
5. **Connection:** Connected the frontend to the backend using HTTP requests and JSON responses.
6. **Refinement:** Ran both parts locally and improved the queue workflow and interface.


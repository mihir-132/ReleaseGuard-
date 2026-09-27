\# ReleaseGuard



AI-assisted release readiness analysis for software release bundles.



ReleaseGuard analyzes a release ZIP through a deterministic multi-step pipeline, reports findings and deployment readiness, and uses IBM watsonx.ai to generate grounded release notes.



\## Features



\- Upload a release bundle as a ZIP file

\- Live progress for the analysis pipeline using Server-Sent Events (SSE)

\- Eight-step deterministic release analysis

\- Consolidated release report with readiness score and severity

\- Grouped findings by analysis step

\- AI-generated release notes using IBM watsonx.ai

\- Past Reports view for previously completed runs

\- Downloadable release report

\- JSON-based report persistence

\- Automated test suite for pipeline, storage, reporting, and AI integration



\## Architecture



```text

React + Vite

&#x20;    |

&#x20;    | HTTP / SSE

&#x20;    v

Node.js + Express

&#x20;    |

&#x20;    +--------------------+

&#x20;    |                    |

&#x20;    v                    v

Release Pipeline      JSON Storage

(8 analysis steps)    reports / runs

&#x20;    |

&#x20;    v

Report Aggregator

&#x20;    |

&#x20;    v

IBM watsonx.ai

(release notes only)

Technology Stack

* Frontend
* React
* Vite
* JavaScript
* CSS

Backend

* Node.js
* Express
* Server-Sent Events (SSE)

AI

* IBM watsonx.ai
* IBM Granite 4 H Small
* Chat API

Testing

* Vitest

Persistence

* JSON files



Analysis Pipeline



ReleaseGuard processes each uploaded release through eight analysis stages:



1. Release bundle ingestion
2. Code and change analysis
3. Dependency analysis
4. Configuration and environment analysis
5. Security analysis
6. Database migration analysis
7. Deployment/readiness analysis
8. Consolidated report generation and persistence



Each stage produces structured findings that are combined into the final release report.



AI Release Notes



IBM watsonx.ai is used only for generating release notes from verified analysis results.



The application does not allow the model to invent release statistics. Generated notes are validated against the deterministic report before being shown to the user.



The default model is:



ibm/granite-4-h-small

Project Structure

ReleaseGuard/

â”œâ”€â”€ client/              # React + Vite frontend

â”œâ”€â”€ server/              # Node.js + Express backend

â”‚   â”œâ”€â”€ ai/              # watsonx.ai integration

â”‚   â”œâ”€â”€ pipeline/        # release analysis pipeline

â”‚   â””â”€â”€ ...

â”œâ”€â”€ sample-data/         # Synthetic release bundle for testing

â”œâ”€â”€ scripts/              # Development/test helper scripts

â”œâ”€â”€ data/                # Runtime-generated reports and runs

â”œâ”€â”€ bob\_sessions/        # IBM Bob development evidence

â”œâ”€â”€ AGENTS.md            # Project development guidance

â”œâ”€â”€ .env.example         # Environment variable template

â”œâ”€â”€ package.json

â””â”€â”€ release-guard-plan.md

Requirements

* Node.js
* npm
* IBM Cloud / watsonx.ai credentials for AI release notes



Setup



Clone the repository:



git clone https://github.com/mihir-132/ReleaseGuard-.git

cd ReleaseGuard



Install dependencies:



npm install



Create the backend environment file:



.env.example -> server/.env



Then configure the IBM watsonx.ai environment variables in:



server/.env



Do not commit credentials or runtime-generated data.



Environment Variables



The committed .env.example file contains the required variable names.



The backend reads its runtime environment from:



server/.env



Credentials and other sensitive values should never be committed to Git.



Running the Application



Start the development environment:



npm run dev



The application runs with:



* Frontend: http://localhost:5173
* Backend: http://localhost:3000



Testing



Run the complete test suite:



npm test



The project currently contains automated tests covering the release pipeline, reporting, storage, and watsonx.ai integration.



Run a specific server test:



npm run test --workspace=server -- <relative-path-inside-server>



Example:



npm run test --workspace=server -- pipeline/steps/08-report.test.js

Production Build



Build the frontend:



npm run build

Typical Workflow

Upload Release ZIP

&#x20;      |

&#x20;      v

Create Run

&#x20;      |

&#x20;      v

Run 8 Analysis Steps

&#x20;      |

&#x20;      v

Stream Progress to UI

&#x20;      |

&#x20;      v

Aggregate Findings

&#x20;      |

&#x20;      v

Calculate Readiness

&#x20;      |

&#x20;      v

Generate Grounded AI Release Notes

&#x20;      |

&#x20;      v

Persist Report

&#x20;      |

&#x20;      v

View / Download Report

Design Principles



ReleaseGuard separates deterministic analysis from generative AI.



Deterministic pipeline steps are responsible for analyzing the release bundle and producing verified findings and metrics.



IBM watsonx.ai is used as a bounded AI layer for release-note generation rather than as the source of the underlying release analysis.



Current Scope



The project intentionally focuses on release-readiness analysis for an uploaded release bundle.



The MVP does not include:



* User authentication
* Database-backed persistence
* CI/CD integration
* GitHub API integration
* Docker deployment
* Historical trend dashboards
* Full source-code diff visualization



Demo



A typical demo flow is:



1. Open ReleaseGuard
2. Upload the provided synthetic release bundle
3. Watch the eight analysis steps execute live
4. Review the readiness score and findings
5. Review the AI-generated release notes
6. Open Past Reports to load a previous run
7. Download the generated report



IBM Technologies



ReleaseGuard uses IBM watsonx.ai for the AI-powered release-note generation workflow.



The project was developed for the IBM Bob 2.0 Hackathon.



License



This project is provided for hackathon and demonstration purposes.

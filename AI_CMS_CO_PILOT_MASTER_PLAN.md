# Mark AI — AI-Native Co-Pilot & Conversational CMS: Master Architectural Plan

This document serves as the absolute, single source of truth for the **Mark AI Conversational Operating System (Co-Pilot)**. It merges the manual operator workflow, the interactive card designs, the backend agentic tool-calling parameters, and the front-end "ChatGPT Lab" console interface into one seamless blueprint.

---

## 1. Core Philosophy: Emulating the Manual Operator Process

The Mark AI Co-Pilot is not a simple, passive text chatbot. It is an **AI-Native Operator** designed to follow the exact, sequential workflows of a manual Digital Out-of-Home (DOOH) campaign manager.

```
       MANUAL OPERATOR PROCESS                AI-CO-PILOT GUIDED PIPELINE
 ┌─────────────────────────────────┐       ┌─────────────────────────────────┐
 │ 1. Pick physical screen & size  │  ──►  │ STEP 1: Screen First Lock       │
 ├─────────────────────────────────┤       ├─────────────────────────────────┤
 │ 2. Upload/Design creative asset │  ──►  │ STEP 2: Content Upload & Fit    │
 ├─────────────────────────────────┤       ├─────────────────────────────────┤
 │ 3. Create Solution & map zones  │  ──►  │ STEP 3: Solution Layout Mapping │
 ├─────────────────────────────────┤       ├─────────────────────────────────┤
 │ 4. Set calendar time & audits   │  ──►  │ STEP 4: Scheduling & Auditing   │
 └─────────────────────────────────┘       └─────────────────────────────────┘
```

### Strict Workflow Order & Layout Integrity
To prevent design distortion, incorrect scheduling, or content misalignment, the AI-Native Co-Pilot strictly enforces the sequential order of operations. No steps may be bypassed:

1. **Step 1: Screen Selection FIRST (Resolution Lock)**
   * **Why first?** Screens possess non-standard physical resolutions (e.g., Portrait `1080x1920` vs. Landscape `1920x1080`). 
   * **Safety Constraint:** If content is designed or uploaded before selecting the target screen, it risks being stretched, squished, or cropped on the physical player. Selecting the screen first establishes a strict resolution anchor.
2. **Step 2: Content Creation & Upload**
   * Uploading or creating creative media assets within the **Content Section**.
   * Assets are immediately checked against the active screen's locked resolution and orientation to ensure a perfect visual fit.
3. **Step 3: Solution Layout Configuration**
   * Splitting the target screen viewport into multi-zone partitions (or choosing standard full-screen) and mapping uploaded content files directly into those coordinates.
4. **Step 4: Scheduling, Audits & Final WYSIWYG Preview**
   * Configuring the schedule bounds (dates, operating hours, repetition frequency).
   * Selecting the audit verification tier (Standard Cryptographic POP vs. Premium Loop Screenshots).
   * Rendering a live player simulator inside a styled physical screen bezel mock-up so the user sees exactly how the final loop plays before checkout.

### The Operator Confirmation Mandate (User-in-the-Loop Decisions)
To maintain absolute alignment and user control over physical campaign designs, **the AI-Native Co-Pilot must never execute final layout divisions, splits, or scheduling configurations silently**. 
* **The Role of the Operator:** The AI operates purely as an agentic assistant that drafts and proposes options. The user/operator retains full executive authority and must explicitly select, adjust, or confirm each state change.
* **No Silent Autonomic Actions:** For example, in **Step 3 (Solution Layout Mapping)**, the AI must not independently assume a specific split layout (like top/bottom or triple-split) or auto-assign content to coordinate slices on its own. It must present explicit choices to the user (e.g., standard full-screen vs. specific multi-zone splits), prompt for their selection, and wait for confirmation before applying the layout.

---

## 2. The Strict 4-Step Conversational Pipeline (with Multi-Parameter Extraction Bypass)

To ensure absolute database safety, resolution matching, and 100% schedule auditing, **the AI follows this strict pipeline without manual shortcuts**. 

However, to provide a frictionless user experience, **if the user provides multiple or all details in a single prompt, the AI must NOT ask redundant step-by-step questions**. Instead, the AI parses all arguments in parallel, runs them through a Solution Confidence Filter, automatically populates and locks the resolved steps, and **ONLY asks questions about details it is not 100% sure about or are missing**.

If the user provides all details upfront and everything is clear, the AI bypasses all step-by-step confirmation prompts entirely and fast-tracks the user directly to the final checkout preview screen (Container E).

```
                          ┌────────────────────────────────┐
                          │    USER INPUT WITH MULTIPLE    │
                          │      DETAILS & PARAMETERS      │
                          └───────────────┬────────────────┘
                                          │
                                          ▼
                          ┌────────────────────────────────┐
                          │   PARALLEL PARAMETER PARSER    │
                          │   Extracts: Screen, Content,   │
                          │ Layout, Schedule & Audit Tiers │
                          └───────────────┬────────────────┘
                                          │
                                          ▼
                          ┌────────────────────────────────┐
                          │   SOLUTION CONFIDENCE FILTER   │
                          │  Evaluates certainty of each   │
                          │    extracted parameter step    │
                          └───────────────┬────────────────┘
                                          │
                 ┌────────────────────────┴────────────────────────┐
                 │                                                 │
      [Some Parameters Unsure]                           [All Parameters Resolved]
                 │                                                 │
                 ▼                                                 │
┌─────────────────────────────────┐                                │
│      TARGETED INQUIRY LOOP      │                                │
│  - Auto-populates locked steps  │                                │
│  - ONLY asks questions for slots│                                │
│    the AI is NOT sure about     │                                │
└────────────────┬────────────────┘                                │
                 │                                                 │
                 ▼                                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 👁️ CONTAINER E: FINAL WYSIWYG OUTPUT PREVIEW & CHECKOUT                      │
│   "Here is exactly how your campaign will render playing live on the screen:"│
│                                                                             │
│   ┌───────────────────────────────────────────────────────┐                 │
│   │                 [ Preview Canvas Area ]               │                 │
│   │   Starbucks Top Banner / Running Loop Video Sidebar   │                 │
│   └───────────────────────────────────────────────────────┘                 │
│                                                                             │
│   • Total Cost: $210.00/month (Includes Premium Loop SC)                   │
│                                                                             │
│   [ Yes, Deploy Campaign 🚀 ]              [ No, Edit Campaign ✏️ ]          │
└─────────────────────────────────────────────────────────────────────────────┘```

### The Rule of Zero-Redundancy & Confidence-Based Inquiry (Frictionless UX)
* **Single-Turn Intent Extraction:** If the user sends a rich initial prompt (e.g., *"Set up standard full-screen campaign for CP Screen 1 on Monday from 1 to 2 PM using my summer_sale.mp4 video"*), the LLM must execute parallel extraction.
* **Redundancy Suppression:** The AI **must not** ask the user *"Can you select a screen first?"* or *"Please upload your creative now."*
* **Auto-Resolution Mapping:** The AI internally resolves the Screen ID, verifies that `summer_sale.mp4` matches the screen resolution, creates the full-screen layout solution, sets the hourly boundaries, and **bypasses Steps 1 through 3 entirely**.
* **Zero-Redundancy Questions:** The AI evaluates each parameter's clarity. If a parameter is already fully specified and unambiguous, it is locked. The AI **only** asks questions for parameters where the solution is unsure or missing.
* **Targeted Halt:** The AI skips straight to Step 4 (asking only if they want Standard POP or Premium Loop SC) or directly shows the **Container E: Final WYSIWYG Preview & Checkout if all variables are completely clear**.
* **Ambiguity Handling:** If a parameter is unclear (e.g., they specified `"Monday"` but not which date, or they specified a location with multiple screens available), the AI only halts the pipeline at that specific step to ask for clarification, preserving all other correctly extracted parameters.
* **Cross-Turn Parameter Memory (Out-of-Order Input Carry-Over):** If the user specifies scheduling details, active hours, or media assets *prior* to selecting a target screen (e.g., *"I want to run a campaign next Monday from 1 to 2 PM"* but no screen has been resolved yet), the AI must store these details in the session draft buffer. When the user eventually selects a screen later in the chat, the AI **must not** prompt for timing again. It must automatically carry over the previously stated schedule, apply it to the screen, and confirm: *"Target screen CP Screen 1 resolved! I've automatically applied your previously stated schedule of next Monday from 1:00 to 2:00 PM."*
* **The User Confirmation Mandate:** The AI must never bypass the user's role in making layout, content fitment, or scheduling decisions. Even if details are extracted parallelly or carried over, the AI must present each decision clearly and wait for user approval or button selection. For example, rather than splitting a screen into multiple zones automatically, the AI must present the option to the user (e.g., standard full-screen, split-screen into two horizontal zones, split into multiple zones) and let the user select/confirm their exact layout choice first. The AI's role is to ask; the user's role is to choose and confirm.

## 3. Detailed Breakdown of the 4 Pillars & Verification Models

### Pillar 1: Target Screen Resolution Locking (Step 1)
The physical display screen acts as the structural anchor of the entire booking pipeline:
* **Interactive Discovery:** The operator queries the AI (e.g., "Find screens in South West London"). The AI responds with matching screens inside a selection grid container.
* **Aspect Ratio Isolation:** Once the operator selects a screen, the system reads its metadata resolution columns (e.g., `resolution="1080x1920"`, `aspect_ratio="9:16"`, `orientation="portrait"`).
* **Downstream Safety:** This locked geometry is propagated to the rest of the conversation context. Future assets uploaded must conform to this physical shape or they will throw a visual warning.

### Pillar 2: Content Section & Upload Fit Verification (Step 2)
The operator introduces media files through the interactive **Content Section** card:
* **Dropzone Ingestion:** Interactive drag-and-drop media cards let operators drop image (`PNG`, `JPG`) or video (`MP4`) assets directly into the chat thread.
* **Fit Safety Check:** The frontend executes an automatic validation loop. If a landscape image (`16:9`) is dropped into a locked portrait screen (`9:16`), the AI prints a warning:
  > [!WARNING]
  > **Aspect Ratio Mismatch Alert**
  > The selected screen "CP Screen 1" requires portrait content (`1080x1920`). Your uploaded asset "summer_sale.jpg" has landscape dimensions (`1920x1080`) and will be stretched or letterboxed.
* **Database Cataloging:** Validated creatives are uploaded to storage (e.g. Cloudinary/S3) and registered in the `media` database.

### Pillar 3: Solution Layout Creation (Step 3)
A **Solution** represents the geometric division of the screen space:
* **Layout Grid Options:** The operator chooses how the active screen should split:
  1. *Standard Full-Screen:* A single layout zone covering the entire pixel grid.
  2. *Custom Split-Screen (Multi-Zone):* Divides the screen into independent partitioned coordinates (e.g., top-banner, middle-video, bottom-ticker).
* **Visual Layout Designer:** An interactive canvas card appears within the chat bubble allowing operators to slide partition boundaries and drop distinct media items from the Content Section into specific zones.
* **Registration:** The compiled split coordinates are saved as a layout dictionary and passed directly to the billing and playback players.

### Pillar 4: Scheduling & Audit Verification Models (Step 4)
The scheduling and proof-of-play (POP) verification engine ensures campaigns play exactly when ordered, offering a choice between cost-effective standard verification and premium screenshot audits:

| Feature / Model | Standard Cryptographic POP (Included) | Premium Loop Screenshot (Surcharge) |
| :--- | :--- | :--- |
| **Log Precision** | **Full Playback Telemetry** | **Full Playback Telemetry** |
| **Playback Timestamps** | Captures the exact date & time for every single play event ("every time data time" log). | Captures the exact date & time for every single play event. |
| **Play Counter** | Records exactly how many times it played throughout the day. | Records exactly how many times it played throughout the day. |
| **Visual Verification** | **3 Milestone Screenshots (Start, Mid, End SC)** | **Continuous Periodic Screenshots** |
| **Screenshot Overhead** | **Low-Overhead.** Avoids taking screenshots every play ("except every time SC") to prevent massive data costs. | **High-Overhead.** Takes screenshots continuously (e.g., every 15 mins) on client players. |
| **Pricing / Cost** | **Free / Included** (Cost-effective default). | **Premium Surcharge** (Charges more due to storage and bandwidth costs). |

#### Why avoid taking screenshots every single playback in Standard POP?
Taking screenshots for every individual play loop ("except taking screenshots every single time") creates extreme processing bottlenecks, drains client device mobile data plans, and consumes terabytes of useless storage on our servers. By tracking the exact datetime and play count cryptographically, and supplementing it with **3 tactical Milestone Screenshots (Start of Campaign, Mid-Way, and End of Campaign)**, the standard POP model gives clients ironclad evidence of campaign execution at zero extra charge.

If clients require active, near-real-time proof that their loop is rendering correctly at any hour of the day, they must opt-in to the **Premium Loop SC** model and pay the associated data surcharge.

---

## 4. Live WYSIWYG Output Preview & Simulator

Before checkout, the operator is shown a highly polished, responsive visual mockup simulator representing the exact physical output:

```
┌────────────────────────────────────────────────────────┐
│ 📺 LIVE CAMPAIGN PREVIEW SIMULATOR                     │
├────────────────────────────────────────────────────────┤
│                                                        │
│   [ PORTRAIT DISPLAY BEZEL ]                           │
│   ┌────────────────────────────────────────────────┐   │
│   │ ZONE A: SUMMER SALE PROMO (IMAGE - 1080x480)   │   │
│   ├────────────────────────┬───────────────────────┤   │
│   │ ZONE B: TIME WIDGET    │ ZONE C: COLA.MP4      │   │
│   │ (HTML - 480x1440)      │ (VIDEO - 600x1440)    │   │
│   │                        │                       │   │
│   │ [15:59:57]             │ [PLAYING VIDEO 🔊]     │   │
│   └────────────────────────┴───────────────────────┘   │
│                                                        │
│   Loop Playback Sequence Status: Running... 🟢         │
└────────────────────────────────────────────────────────┘
```

* **Physical Display Bezel Mock:** The simulator renders a styled dark metal display bezel reflecting the selected screen's orientation (portrait/landscape) and resolution.
* **Active Layout Rendering:** CSS Flexbox/Grid applies the solution coordinates, rendering the active images, videos, or HTML widgets playing live in real time.
* **Operator Confidence:** Operators see exactly how their multi-zone layout loops and plays, removing any fear of visual distortion before final payment.

---

## 5. Technical Integration Schemas

The backend FastAPI models fully support these multi-layered auditing and layout definitions:

### Pydantic Campaign Booking Schema
```python
from pydantic import BaseModel, Field
from typing import List, Literal, Optional
from datetime import datetime

class CreateBookingRequest(BaseModel):
    name: str = Field(..., description="Name of the campaign booking")
    screen_id: str = Field(..., description="Target screen locked in Step 1")
    media_id: Optional[str] = Field(None, description="Primary content asset ID")
    
    # Timing Constraints
    schedule_type: Literal["continuous", "specific_time", "times_per_day", "custom"]
    start_at: datetime = Field(..., description="Campaign start calendar date")
    end_at: datetime = Field(..., description="Campaign end calendar date")
    daily_start: Optional[str] = Field("09:00", description="Daily play window opening")
    daily_end: Optional[str] = Field("21:00", description="Daily play window closing")
    
    # Layout "Solution" Multi-Zone Coordinates
    layout: Optional[dict] = Field(
        None, 
        description="JSON dictionary specifying coordinate splits and mapped media IDs."
    )
    
    # Audit Verification Choices
    milestone_screenshots_enabled: bool = Field(
        True, 
        description="Enables standard Start, Mid, and End milestone screenshots (Standard POP)."
    )
    screenshot_enabled: bool = Field(
        False, 
        description="Enables premium periodic Loop Screenshot captures (Premium Surcharge)."
    )
```

### DB Screenshot Audit Records
```python
class ScreenshotRecord(BaseModel):
    id: str
    booking_id: str
    screen_id: str
    cloudinary_url: str
    shot_type: Literal["milestone_start", "milestone_mid", "milestone_end", "loop"]
    captured_at: datetime
```

---

## 6. Front-End Component Layout (ChatGPT Lab Interface)

The AI interface is modeled as a premium, state-of-the-art **ChatGPT-Style Workstation** structured inside `src/app/(dashboard)/ai-assistant/page.tsx`. To optimize workspace organization, the page splits into a professional **Three-Pane Grid Layout**:

```
 ┌──────────────────────────┬───────────────────────────────┬──────────────────────────┐
 │                          │                               │                          │
 │                          │   ORCHESTRATOR CHAT WINDOW    │  WORKSPACE TELEMETRY     │
 │  CHATGPT HISTORY SIDEBAR │                               │  & PREVIEW PANEL         │
 │                          │  ┌─────────────────────────┐  │                          │
 │  [+ New Chat]            │  │ AI: Target screen locked│  │  📺 LOCK STATUS          │
 │                          │  └─────────────────────────┘  │     Screen: CP Screen 1  │
 │  - Starbucks Promo       │                               │     Resolution: 9:16     │
 │  - CP Zone Split         │  ┌─────────────────────────┐  │                          │
 │  - Daily Loop Setup      │  │ User: [Drop media here] │  │  🖼️ ASSET SUMMARY        │
 │  - Screen Search CP      │  └─────────────────────────┘  │     Loaded: 3 files      │
 │  - High Traffic Audit    │                               │                          │
 │  - Ticker Feed Layout    │  ┌─────────────────────────┐  │  📺 WYSIWYG LIVE PREVIEW │
 │                          │  │ AI: Solution layout ready│  │  ┌────────────────────┐  │
 │                          │  └─────────────────────────┘  │  │ Starbucks Top Ad   │  │
 │                          │                               │  ├────────────────────┤  │
 │                          │  [ Enter prompt here...   ]   │  │ Clock  │ Video Ad  │  │
 │                          │                               │  └────────────────────┘  │
 └──────────────────────────┴───────────────────────────────┴──────────────────────────┘
```

1. **Left Column: ChatGPT Recent History Sidebar (Width: 260px)**
   * **Visual styling:** Dark slate glassmorphic surface (`bg-slate-950/80 backdrop-blur-md`) bordering the main chat panel.
   * **Action Trigger:** An accent `+ New Chat` button to spawn clean sessions instantly.
   * **Recent Chats:** Chronological scrolling list displaying up to **10 recent conversations** (complete with edit and clear icons).
2. **Center Column: Core Chat Thread Pane (Flex-1)**
   * Scrollable glassmorphic chat bubble workspace displaying user inputs, assistant responses, and inline interactive cards (screen selection grid, dropzone, layout builder).
   * Houses the sticky bottom chat search box containing input validators, status indicators, and prompt recommendations.
3. **Right Column: Telemetry & Active Live Preview Panel (Width: 340px)**
   * Persistently details active operational draft states (resolved screen IDs, target coordinate schemas, current pricing variables).
   * **Live Preview Simulator Bezel:** Operates the active live mock container showcasing CSS grid divisions and rendering active assets loops visually.

---

## 7. Stateful Session Persistence & Recent History Mechanics

To ensure operators can transition between multiple drafts without losing valuable progress or breaking the conversational context, the frontend supports automatic session management:

### Conversation State Schema
```typescript
interface ChatSession {
  id: string;              // Unique Thread Session ID
  title: string;           // Auto-generated summary (e.g. "Connaught Place Booking")
  messages: ChatMessage[]; // Full text array of roles and content
  session_state: {         // Associated CMS session parameters
    screen_id: string | null;
    media_ids: string[];
    layout_data: dict | null;
    milestone_screenshots_enabled: boolean;
    screenshot_enabled: boolean;
    draft_schedule: {      // Persists out-of-order timings across turns
      start_at: string | null;
      end_at: string | null;
      days: string[];
    } | null;
  };
  last_active: Date;
}
```

### Context Continuation & Pruning Rules
* **The 10-Chat Rule:** The frontend keeps a maximum of **10 active chat sessions** cached in the database (or locally under the user’s account).
* **Automatic Eviction (FIFO):** If a user clicks `+ New Chat` and they already have 10 saved threads, the system automatically prunes the oldest conversation by timestamp.
* **Context Preservation:** Clicking any historical thread item from the ChatGPT Sidebar loads the specific `ChatSession` data structure:
  1. Spitefully swaps the frontend messages array, displaying previous bubbles instantly.
  2. Submits the session's historical list inside the `history` parameter payload of subsequent `api.aiChat` API requests.
  3. Commands the backend via a `/ai-assistant/state/sync` WebSocket or REST endpoint to align the backend's thread-safe state store (`CmsAiSessionStore`) to match the selected session variables.
* **Draft Schedule Carry-Over:** If `draft_schedule` (including timing bounds and active days) is populated in the `session_state` before a `screen_id` is selected, it must be carried forward and merged into Step 4 configurations immediately when the screen is eventually locked, eliminating any redundant prompt.
* This architecture allows users to start configuring split zones for a Connaught Place screen, switch to a different conversation to query and check prices on a Phoenix Mall screen, and switch back to the Connaught Place chat to continue scheduling right where they left off.

---

## 8. Real-Time Streaming Architecture via Redis Pub/Sub

To deliver low-latency chatbot streaming responses, instantaneous playback synchronization, and real-time background task updates to the browser interface, we utilize a **Redis Pub/Sub (Publish/Subscribe) messaging layer**.

```
                           ┌────────────────────────┐
                           │   USER WEB BROWSER     │
                           └───────▲────────┬───────┘
                     SSE / Websocket Streams│ User Chat / confirm REST calls
                                   │        ▼
                           ┌───────┴────────┐
                           │  FASTAPI APP   │
                           │  (API NODES)   │
                           └───────▲────────┘
                                   │ Redis Pub/Sub channels (Subscribed)
                                   ▼
                       ┌───────────────────────┐
                       │  REDIS MEMORY BUFFER  │
                       └───────────────────────┘
                                   ▲
                                   │ Redis Pub/Sub channels (Published)
                       ┌───────────┴───────────┐
                       │   BACKGROUND WORKER   │
                       │   (Celery / Py Tasks) │
                       └───────────▲───────────┘
                                   │ WebSockets commands
                                   ▼
                       ┌───────────────────────┐
                       │PHYSICAL SCREEN PLAYER │
                       └───────────────────────┘
```

### Redis Channels Schema Mapping

Redis Pub/Sub segments real-time streams into two isolated, high-performance messaging channels:

1. **User Chat & Status Channel (`chat_channel:{username}:{session_id}`)**
   * **Purpose:** Streams token-by-token LLM responses directly to the user's browser, and dispatches status cards from asynchronous workers (e.g., "Uploading media...", "Asset layout compiled!").
   * **Subscribers:** FastAPI SSE (Server-Sent Events) or WebSocket connection handler connected to the operator's browser session.
   * **Publishers:** Gemini API stream chunk generators, or celery background media processors completing layout compilations.
2. **Player Command Channel (`player_channel:{screen_id}`)**
   * **Purpose:** Drives instant real-time player actions over high-speed networks, bypassing polling models.
   * **Subscribers:** WebSocket connection handlers linked with the active physical signage device.
   * **Publishers:** The CMS booking backend when a transaction checkout commits (triggers **instant hot-swapped playback** with 0ms device downtime), or when a cron-job requests a manual/milestone camera screenshot snap.

### Backend Python Integration Blueprint
This pattern allows our API nodes to scale-out horizontally behind a load balancer since Redis acts as the unified, shared real-time message bus.

#### Subscribing to Chat Streams (FastAPI Route)
```python
import aioredis
import asyncio
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

router = APIRouter()

async def redis_event_generator(username: str, session_id: str):
    redis = await aioredis.from_url("redis://localhost:6379")
    pubsub = redis.pubsub()
    channel_name = f"chat_channel:{username}:{session_id}"
    await pubsub.subscribe(channel_name)
    
    try:
        while True:
            message = await pubsub.get_message(ignore_subscribe_messages=True)
            if message:
                data = message['data'].decode('utf-8')
                yield f"data: {data}\n\n"
            await asyncio.sleep(0.01) # Yield execution thread
    finally:
        await pubsub.unsubscribe(channel_name)
        await pubsub.close()

@router.get("/ai-assistant/stream/{session_id}")
async def stream_chat_updates(session_id: str, current_user = Depends(get_current_user)):
    return StreamingResponse(
        redis_event_generator(current_user.username, session_id),
        media_type="text/event-stream"
    )
```

#### Publishing Status Events (Background Worker)
```python
async def publish_chat_status(username: str, session_id: str, data_dict: dict):
    redis = await aioredis.from_url("redis://localhost:6379")
    channel_name = f"chat_channel:{username}:{session_id}"
    await redis.publish(channel_name, json.dumps(data_dict))
    await redis.close()
```

---

## 9. Premium Styling Guidelines

To guarantee a modern, luxury look and feel:
* **Backgrounds:** Utilize deep professional dark aesthetics (Slate `#0B0F19` to `#111827`) coupled with modern frosted glassmorphic containers.
* **Accents:** Neon Indigo (`#6366F1`), Cyber Emerald (`#10B981`), and Electric Cobalt (`#3B82F6`) represent selection states and status indicators.
* **Typography:** Render crisp, anti-aliased sans-serif modern typefaces (e.g., Outfit or Inter) with spacious text tracking.

---

## 10. Asynchronous Chat Processing & Priority Queueing

To handle thousands of concurrent operator chat sessions without exhausting FastAPI thread pools or triggering web-server gateway timeouts, the **Conversational Core is completely offloaded to an Asynchronous Background Queue**.

### The Asynchronous Chat Loop Architecture

Instead of the API server invoking the Gemini model synchronously inside the web request, we transform the chat prompt lifecycle into a dedicated background job.

```
                           ┌────────────────────────────────────────┐
                           │        USER WEB BROWSER CLIENT         │
                           └───────────┬────────────────▲───────────┘
                   1. POST Prompt      │                │ 6. Streams Tokens / Cards
                   (Returns immediately)                │    via SSE or WebSockets
                                       ▼                │
                           ┌────────────────────────────┴───────────┐
                           │           FASTAPI WEB SERVER           │
                           └───────────┬────────────────▲───────────┘
                    2. Drops job into  │                │ 5. Listens & Subscribes
                       Redis queue     │                │    to Redis Pub/Sub
                                       ▼                │
                           ┌────────────────────────────┴───────────┐
                           │          REDIS MEMORY ENGINE           │
                           │   (Queue Broker + Pub/Sub channel)     │
                           └───────────┬────────────────▲───────────┘
                    3. Worker pulls    │                │ 4. Worker publishes
                       job from queue  │                │    response chunks
                                       ▼                │
                           ┌────────────────────────────┴───────────┐
                           │         DEDICATED CHAT WORKERS         │
                           │  (Runs LLM, Tool queries & logic)      │
                           └────────────────────────────────────────┘
```

### Detailed Execution Sequence

1. **Ingress Handshake:**
   * The browser posts the user's prompt to the endpoint `POST /ai-assistant/message`.
   * The FastAPI server generates a unique `message_id` and records the record in Postgres as `status="queued"`.
   * The server drops the payload (user prompt, historical context, session variables) into the Redis priority queue and **immediately responds to the browser (within <1ms)**:
     ```json
     {"status": "queued", "message_id": "msg_987"}
     ```
2. **Worker Dequeuing:**
   * A pool of stateless Python **Chat Workers** (listening on Celery or Redis Queue) pops the prompt.
   * The worker updates the Postgres database state of the message to `status="processing"`.
3. **Execution & Tool Operations:**
   * The Chat Worker executes the Gemini model. If Gemini triggers a database tool-call (e.g., finding screen records, verifying content ratios, compiling layout vectors), the worker executes those SQL actions locally.
4. **Token Streaming (Redis Pub/Sub):**
   * As the worker reads streamed text chunks from the Gemini API, it publishes them instantly to the Redis Pub/Sub channel `chat_channel:{username}:{session_id}`.
   * When the final layout or booking success card compiles, the worker publishes the card JSON payload and flips the Postgres record to `status="completed"`.
5. **SSE Flushing:**
   * The browser remains connected to a persistent HTTP Server-Sent Events (SSE) route: `GET /ai-assistant/stream/{session_id}`.
   * The FastAPI server subscribes to the Redis Pub/Sub channel, reads the incoming tokens or card updates published by the worker, and instantly flushes them down the SSE stream to render on the client's screen.

### Priority Queueing & Worker Scaling
To protect transactional booking flows during high chat traffic, Redis organizes chat jobs into two priority queues:
* **`premium_chat_jobs` (High Priority):** Dedicated to operators undergoing active draft checkouts, payment flows, or bulk-scheduling operations (ensuring 0 wait times).
* **`standard_chat_jobs` (Normal Priority):** Dedicated to general conversational queries, welcome screens, and fleet metrics requests.

Chat Workers scale independently from the API server nodes, allowing you to scale up GPU/CPU-intensive inference workers on your orchestrator (Kubernetes) without degrading the load capacity of the primary CMS web console.

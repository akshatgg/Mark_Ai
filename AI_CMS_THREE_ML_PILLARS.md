# Mark AI — Three Machine Learning Pillars & Edge Intelligence Strategy

This document details the complete architectural layout, database models, and training pipelines for the Mark AI DOOH Platform scaling up to 100k-200k screens. It outlines how we implement dynamic traffic intelligence, programmatic brand safety, and allocation optimization using three specialized machine learning pillars while guaranteeing low network load, maximum privacy, and minimal server costs.

---

## 1. Executive Summary
Traditional Digital Out-of-Home (DOOH) platforms suffer from astronomical cloud costs and privacy concerns due to continuous streaming and constant server-side inference. Mark AI solves these issues by pushing the intelligence to the edge. Our architecture relies on three core machine learning models operating in a hybrid edge-cloud paradigm:
1. **Edge-Camera Live Traffic (Model 2):** Runs locally on the display media players using TFLite to detect and count viewers without uploading any visual or raw data to the cloud.
2. **Contextual Recommender Engine (Model 3):** Combines spatial indexing (PostGIS) with historical traffic patterns to optimize the placement and booking counts for campaigns, maintaining absolute screen-owner pricing control.
3. **Competitor Brand-Exclusion (Model 5):** Scans uploaded creative assets to catalog logos and product categories, ensuring competitor ads never play in adjacent or overlapping slots in a playback loop.

---

## 2. Pillar 1: Edge-Camera Live Traffic (Model 2)

### A. The Core Logic
* **What runs it:** A local, offline **TensorFlow Lite (TFLite)** runtime compiled inside the Kotlin `markai-player-apk` project.
* **How it operates:** It captures real-time video frames from a USB camera connected to the physical media player box (e.g., ScreenOx box), passes them through a pre-trained face-detector model (e.g., *SSD MobileNet*), and tracks crowd counts and dwell-time (attention spans).
* **Why we need ML:** Traditional code cannot read raw pixels and count human faces. This offline-first TFLite model provides world-class computer vision with 0% cloud cost and 100% user privacy. No raw video feed ever leaves the physical venue.

### B. Screen Operating Hours & The 42-Row Model
* **The Problem:** Screens do not run 24/7. Most are inside cafes, gyms, or shops operating only 5 to 6 hours per day. Storing empty 24-hour schedules is a waste of space and makes queries slow.
* **The Solution:** We only save traffic data for the screen's actual **operating limits**.
* **Data Volume:** For a screen running 6 active hours per day:
  * **6 active hourly slots** per day.
  * **6 rows * 7 days = 42 rows per screen** total stored in our database.
  * 100,000 screens = **only 4.2 Million rows** in the entire table. This is tiny, fast to index, and runs entirely in server memory!

### C. The Monthly In-Place Update (No Bloat)
* **How it updates:** Once a month, a background python task gathers the past 30 days of actual edge traffic counts and updates/replaces these 42 rows **in-place** using SQL `UPSERT` (`ON CONFLICT`).
* **No Data Deletion for ML:** To prevent our main database from growing, we write the raw, minute-by-minute logs into highly compressed **Parquet files on Google Cloud Storage (GCS)** before pruning. This keeps Postgres small and responsive, while retaining **100% of your historical training data** in cold storage for your ML training loop ($0.02/GB)!

---

## 3. Pillar 2: Contextual Recommender Engine (Model 3)

### A. Core Architecture
* **Do we train from scratch?** **Yes, 100% from scratch** on your database, because your screens, categories, and traffic curves are completely unique.
* **How it works:** When a user chats in the dashboard, the FastAPI server evaluates the advertiser's category, matches nearby screens using **PostGIS (Geospatial SQL)**, and calculates weighted traffic averages on the fly.
* **Dynamic Custom Slots:** If the user books a custom time like **1:30 PM to 2:30 PM**, the backend loads the overlapping hourly traffic scores (e.g., Hour 13 and Hour 14) and computes the exact weighted average in Python:
  $$\text{Weighted Average} = \frac{\text{Traffic(13:00-14:00)} \times 0.5 + \text{Traffic(14:00-15:00)} \times 0.5}{1.0}$$

### B. Screen Owner Budget Control
* **The Constraint:** The ML does **not** decide pricing. Pricing/budgets are immutably fixed by the **Screen Owners** in the database.
* **The Objective:** The ML serves strictly as an **Allocation Optimizer**—solving how to distribute the client's budget to get them the absolute maximum views/impressions under the owner's fixed prices.

---

## 4. Pillar 3: Competitor Brand-Exclusion & Inventory Optimizer (Model 5)

### A. Core Vision Mechanism
* **Training Method:** **Transfer Learning / Fine-Tuning** on top of a pre-trained Vision model (ResNet50 / ViT).
* **How it works:** Whenever a new video/image ad is uploaded, a background task extracts keyframes and passes them to our vision model to detect brand logos (e.g., *Pepsi*) and categories (e.g., *Beverages*).
* **The Automation:** It saves these competitor signatures in Postgres. When scheduling loops, the system automatically checks this table to ensure direct competitors are **never placed in the same playlist loops**, protecting brand-safety and charging premium rates.

---

## 5. Production Postgres Schema Design

### A. `screen_operating_traffic` (Operating Slots Table)
```sql
CREATE TABLE screen_operating_traffic (
    id SERIAL PRIMARY KEY,
    screen_id VARCHAR REFERENCES screens(screen_id) ON DELETE CASCADE,
    day_of_week INT NOT NULL, -- 0=Sunday, 1=Monday, etc.
    open_hour INT NOT NULL, -- e.g., 13 (1:00 PM)
    close_hour INT NOT NULL, -- e.g., 18 (6:00 PM)
    hourly_traffic JSONB NOT NULL, -- e.g., {"13": 70, "14": 80, "15": 85}
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_screen_operating_traffic ON screen_operating_traffic(screen_id, day_of_week);
```

### B. `screen_brand_signatures` (Competitor Vision Table)
```sql
CREATE TABLE screen_brand_signatures (
    id SERIAL PRIMARY KEY,
    booking_id INT REFERENCES bookings(id) ON DELETE CASCADE,
    brand_name VARCHAR(255) NOT NULL,
    category VARCHAR(255) NOT NULL, -- e.g., "Beverages", "Automotive"
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 6. The ML Training & Hot-Reload Loop

```
┌────────────────────────┐      ┌────────────────────────┐      ┌────────────────────────┐
│  1. CONTINUOUS CAPTURE  │ ──►  │ 2. COLD-STORAGE GCS    │ ──►  │ 3. RETRAINING LOOP     │
│  Real-time edge counts  │      │ Raw logs >7 days are   │      │ Sunday midnight tasks  │
│  written to PostgreSQL  │      │ flushed as Parquet     │      │ write updated weights  │
└────────────────────────┘      └────────────────────────┘      └───────────┬────────────┘
                                                                            │
                                                                            ▼
┌────────────────────────┐                                      ┌────────────────────────┐
│  5. LIVE PLAYBACK      │ ◄──────────────────────────────────  │ 4. FASTAPI HOT-RELOAD  │
│  Zero player downtime, │                                      │ Instantly loads new    │
│  instant allocation    │                                      │ weight JSON in memory  │
└────────────────────────┘                                      └────────────────────────┘
```

1. **Continuous Capture:** Standard heartbeats capture real-time edge-camera counts and write to PostgreSQL.
2. **Cold-Storage Archive:** A weekly background task flushes raw data older than 7 days as compressed **Parquet files** to GCS.
3. **Model Re-training:** Every Sunday at midnight, our PyTorch/XGBoost training pipeline reads the GCS archive and updates the Recommender weights, saving `recommender_latest.json`.
4. **Hot-Reload:** The FastAPI API server monitors this JSON file and instantly loads the new model into memory with **zero server downtime**!

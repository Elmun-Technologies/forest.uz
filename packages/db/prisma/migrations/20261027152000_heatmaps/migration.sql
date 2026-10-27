-- A3 heatmaps (CLAUDE.md §6): per-day aggregates rebuilt by the `heatmaps.aggregate` job.

-- CreateTable
CREATE TABLE "HeatmapCell" (
    "day" DATE NOT NULL,
    "path" TEXT NOT NULL,
    "device" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "HeatmapCell_pkey" PRIMARY KEY ("day","path","device","kind","x","y")
);

-- CreateTable
CREATE TABLE "HeatmapElement" (
    "day" DATE NOT NULL,
    "path" TEXT NOT NULL,
    "device" TEXT NOT NULL,
    "selector" TEXT NOT NULL,
    "label" TEXT,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "rage" INTEGER NOT NULL DEFAULT 0,
    "dead" INTEGER NOT NULL DEFAULT 0,
    "exits" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "HeatmapElement_pkey" PRIMARY KEY ("day","path","device","selector")
);

-- CreateTable
CREATE TABLE "HeatmapPage" (
    "day" DATE NOT NULL,
    "path" TEXT NOT NULL,
    "device" TEXT NOT NULL,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "pageviews" INTEGER NOT NULL DEFAULT 0,
    "reach25" INTEGER NOT NULL DEFAULT 0,
    "reach50" INTEGER NOT NULL DEFAULT 0,
    "reach75" INTEGER NOT NULL DEFAULT 0,
    "reach100" INTEGER NOT NULL DEFAULT 0,
    "scrollSum" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "rage" INTEGER NOT NULL DEFAULT 0,
    "dead" INTEGER NOT NULL DEFAULT 0,
    "lcpCount" INTEGER NOT NULL DEFAULT 0,
    "lcpSlow" INTEGER NOT NULL DEFAULT 0,
    "lcpSumMs" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "HeatmapPage_pkey" PRIMARY KEY ("day","path","device")
);

-- CreateIndex
CREATE INDEX "HeatmapPage_day_device_idx" ON "HeatmapPage"("day", "device");


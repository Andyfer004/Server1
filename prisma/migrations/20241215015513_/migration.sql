/*
  Warnings:

  - A unique constraint covering the columns `[threadId]` on the table `Thread` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Thread_threadId_key" ON "Thread"("threadId");

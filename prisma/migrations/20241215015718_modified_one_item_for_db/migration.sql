-- DropForeignKey
ALTER TABLE "Image" DROP CONSTRAINT "Image_threadId_fkey";

-- AlterTable
ALTER TABLE "Image" ALTER COLUMN "threadId" SET DATA TYPE TEXT;

-- AddForeignKey
ALTER TABLE "Image" ADD CONSTRAINT "Image_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread"("threadId") ON DELETE RESTRICT ON UPDATE CASCADE;

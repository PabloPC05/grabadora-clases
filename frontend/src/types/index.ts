export type RootStackParamList = {
  Home: undefined;
  Record: { subjectId?: number };
  Processing: { taskId: string };
  Note: { noteId: number };
  Subjects: undefined;
  SubjectDetail: { subjectId: number };
};
